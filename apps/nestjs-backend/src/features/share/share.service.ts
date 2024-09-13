import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import type {
  IFilter,
  IFieldVo,
  IViewVo,
  IShareViewMeta,
  ILinkFieldOptions,
  StatisticsFunc,
} from '@teable/core';
import { FieldKeyType, FieldType, ViewType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import {
  type ShareViewFormSubmitRo,
  type ShareViewGetVo,
  type IShareViewRowCountRo,
  type IShareViewAggregationsRo,
  type IRangesRo,
  type IShareViewGroupPointsRo,
  type IAggregationVo,
  type IGroupPointsVo,
  type IRowCountVo,
  type IShareViewLinkRecordsRo,
  type IRecordsVo,
  type IShareViewCollaboratorsRo,
  UploadType,
} from '@teable/openapi';
import { Knex } from 'knex';
import { isEmpty, pick } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import type { IClsStore } from '../../types/cls';
import { isNotHiddenField } from '../../utils/is-not-hidden-field';
import { AggregationService } from '../aggregation/aggregation.service';
import StorageAdapter from '../attachments/plugins/adapter';
import { getFullStorageUrl } from '../attachments/plugins/utils';
import { CollaboratorService } from '../collaborator/collaborator.service';
import { FieldService } from '../field/field.service';
import type { IFieldInstance } from '../field/model/factory';
import { createFieldInstanceByVo } from '../field/model/factory';
import { RecordOpenApiService } from '../record/open-api/record-open-api.service';
import { RecordService } from '../record/record.service';
import { SelectionService } from '../selection/selection.service';
import { createViewVoByRaw } from '../view/model/factory';
import { ViewService } from '../view/view.service';

export interface IShareViewInfo {
  shareId: string;
  tableId: string;
  view: IViewVo;
}

export interface IJwtShareInfo {
  shareId: string;
  password: string;
}

@Injectable()
export class ShareService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly fieldService: FieldService,
    private readonly recordService: RecordService,
    private readonly aggregationService: AggregationService,
    private readonly recordOpenApiService: RecordOpenApiService,
    private readonly selectionService: SelectionService,
    private readonly collaboratorService: CollaboratorService,
    private readonly cls: ClsService<IClsStore>,
    private readonly viewService: ViewService,
    @InjectDbProvider() private readonly dbProvider: IDbProvider,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex
  ) {}

  async getShareView(shareId: string): Promise<ShareViewGetVo> {
    const view = await this.prismaService.view.findFirst({
      where: { shareId, enableShare: true, deletedTime: null },
    });
    if (!view) {
      throw new BadRequestException('share view not found');
    }
    const shareMeta = view.shareMeta ? (JSON.parse(view.shareMeta) as IShareViewMeta) : undefined;
    const { tableId, id: viewId, group } = view;
    const fields = await this.fieldService.getFieldsByQuery(tableId, {
      viewId: view.id,
      filterHidden: !shareMeta?.includeHiddenField,
    });

    let records: IRecordsVo['records'] = [];
    let extra: IRecordsVo['extra'];
    if (view.type !== ViewType.Form) {
      const recordsData = await this.recordService.getRecords(tableId, {
        viewId,
        skip: 0,
        take: 50,
        groupBy: group ? JSON.parse(group) : undefined,
        fieldKeyType: FieldKeyType.Id,
        projection: fields.map((f) => f.id),
      });
      records = recordsData.records;
      extra = recordsData.extra;
    }

    return {
      shareMeta,
      shareId,
      tableId,
      viewId,
      view: this.viewService.convertViewVoAttachmentUrl(createViewVoByRaw(view)),
      fields,
      records,
      extra,
    };
  }

  async getViewAggregations(
    shareInfo: IShareViewInfo,
    query: IShareViewAggregationsRo = {}
  ): Promise<IAggregationVo> {
    const viewId = shareInfo.view.id;
    const tableId = shareInfo.tableId;
    const filter = query?.filter ?? null;
    const fieldStats: Array<{ fieldId: string; statisticFunc: StatisticsFunc }> = [];
    if (query?.field) {
      Object.entries(query.field).forEach(([key, value]) => {
        const stats = value.map((fieldId) => ({
          fieldId,
          statisticFunc: key as StatisticsFunc,
        }));
        fieldStats.push(...stats);
      });
    }
    const result = await this.aggregationService.performAggregation({
      tableId,
      withView: { viewId, customFilter: filter, customFieldStats: fieldStats },
    });

    return { aggregations: result?.aggregations };
  }

  async getViewRowCount(
    shareInfo: IShareViewInfo,
    query?: IShareViewRowCountRo
  ): Promise<IRowCountVo> {
    const viewId = shareInfo.view.id;
    const tableId = shareInfo.tableId;
    const result = await this.aggregationService.performRowCount(tableId, { viewId, ...query });

    return {
      rowCount: result.rowCount,
    };
  }

  async formSubmit(shareInfo: IShareViewInfo, shareViewFormSubmitRo: ShareViewFormSubmitRo) {
    const { tableId, view } = shareInfo;
    const { fields } = shareViewFormSubmitRo;
    if (view.type !== ViewType.Form) {
      throw new ForbiddenException('view type is not form');
    }
    // check field hidden
    const visibleFields = await this.fieldService.getFieldsByQuery(tableId, {
      viewId: view.id,
      filterHidden: !view.shareMeta?.includeHiddenField,
    });
    const visibleFieldIds = visibleFields.map(({ id }) => id);
    const visibleFieldIdSet = new Set(visibleFieldIds);

    if (
      (!visibleFields.length && !isEmpty(fields)) ||
      Object.keys(fields).some((fieldId) => !visibleFieldIdSet.has(fieldId))
    ) {
      throw new ForbiddenException('The form contains hidden fields, submission not allowed.');
    }

    const { records } = await this.prismaService.$tx(async () => {
      this.cls.set('entry', { type: 'form', id: view.id });
      return await this.recordOpenApiService.createRecords(tableId, {
        records: [{ fields }],
        fieldKeyType: FieldKeyType.Id,
      });
    });
    if (records.length === 0) {
      throw new InternalServerErrorException('The number of successful submit records is 0');
    }
    return records[0];
  }

  async copy(shareInfo: IShareViewInfo, shareViewCopyRo: IRangesRo) {
    if (!shareInfo.view.shareMeta?.allowCopy) {
      throw new ForbiddenException('not allowed to copy');
    }

    return this.selectionService.copy(shareInfo.tableId, {
      viewId: shareInfo.view.id,
      ...shareViewCopyRo,
    });
  }

  private async preCheckFieldHidden(view: IViewVo, fieldId: string) {
    // hidden check
    if (!view.shareMeta?.includeHiddenField && !isNotHiddenField(fieldId, view)) {
      throw new ForbiddenException('field is hidden, not allowed');
    }
  }

  async getViewLinkRecords(shareInfo: IShareViewInfo, query: IShareViewLinkRecordsRo) {
    const { tableId, view } = shareInfo;
    const { fieldId } = query;

    await this.preCheckFieldHidden(view, fieldId);

    // link field check
    const field = await this.fieldService.getField(tableId, fieldId);
    if (field.type !== FieldType.Link) {
      throw new ForbiddenException('field type is not link field');
    }

    let recordsVo: IRecordsVo;
    if (view.type === ViewType.Form) {
      recordsVo = await this.getFormLinkRecords(field, query);
    } else {
      recordsVo = await this.getViewFilterLinkRecords(field, query);
    }
    return recordsVo.records.map(({ id, name }) => ({ id, title: name }));
  }

  async getFormLinkRecords(field: IFieldVo, query: IShareViewLinkRecordsRo) {
    const { lookupFieldId, foreignTableId } = field.options as ILinkFieldOptions;
    const { take, skip, search } = query;

    return this.recordService.getRecords(foreignTableId, {
      take,
      skip,
      search: search ? [search, lookupFieldId] : undefined,
      projection: [lookupFieldId],
      fieldKeyType: FieldKeyType.Id,
      filterLinkCellCandidate: field.id,
    });
  }

  async getViewFilterLinkRecords(field: IFieldVo, query: IShareViewLinkRecordsRo) {
    const { fieldId, skip, take, search } = query;

    const { foreignTableId, lookupFieldId } = field.options as ILinkFieldOptions;

    return this.recordService.getRecords(foreignTableId, {
      skip,
      take,
      search: search ? [search, lookupFieldId] : undefined,
      fieldKeyType: FieldKeyType.Id,
      projection: [lookupFieldId],
      filterLinkCellSelected: fieldId,
    });
  }

  async getViewGroupPoints(
    shareInfo: IShareViewInfo,
    query?: IShareViewGroupPointsRo
  ): Promise<IGroupPointsVo> {
    const viewId = shareInfo.view.id;
    const tableId = shareInfo.tableId;

    if (viewId == null) return null;

    return await this.aggregationService.getGroupPoints(tableId, { ...query, viewId });
  }

  async getViewCollaborators(shareInfo: IShareViewInfo, query: IShareViewCollaboratorsRo) {
    const { view, tableId } = shareInfo;
    const { fieldId } = query;

    // only form and kanban view can get all records
    if ([ViewType.Form, ViewType.Kanban].includes(view.type)) {
      return this.getViewAllCollaborators(shareInfo);
    }

    if (!fieldId) {
      throw new BadRequestException('fieldId is required');
    }

    await this.preCheckFieldHidden(view, fieldId);

    // user field check
    const field = await this.fieldService.getField(tableId, fieldId);
    // All user field, contains lastModifiedBy, createdBy
    if (![FieldType.User, FieldType.LastModifiedBy, FieldType.CreatedBy].includes(field.type)) {
      throw new ForbiddenException('field type is not user-related field');
    }

    return this.getViewFilterCollaborators(shareInfo, field);
  }

  private async getViewFilterUserQuery(
    tableId: string,
    filter: IFilter | undefined,
    userField: IFieldVo,
    fieldMap: Record<string, IFieldInstance>
  ) {
    const dbTableName = await this.recordService.getDbTableName(tableId);
    const queryBuilder = this.knex(dbTableName);
    const { isMultipleCellValue, dbFieldName } = userField;

    this.dbProvider.shareFilterCollaboratorsQuery(queryBuilder, dbFieldName, isMultipleCellValue);
    queryBuilder.whereNotNull(dbFieldName);
    this.dbProvider.filterQuery(queryBuilder, fieldMap, filter).appendQueryBuilder();

    return this.knex('users')
      .select('id', 'email', 'name', 'avatar')
      .from(this.knex.raw(`(${queryBuilder.toQuery()}) AS coll`))
      .leftJoin('users', 'users.id', '=', 'coll.user_id')
      .toQuery();
  }

  async getViewFilterCollaborators(shareInfo: IShareViewInfo, field: IFieldVo) {
    const { tableId, view } = shareInfo;
    const fields = await this.fieldService.getFieldsByQuery(tableId, {
      viewId: view.id,
    });

    const nativeQuery = await this.getViewFilterUserQuery(
      tableId,
      view.filter,
      field,
      fields.reduce(
        (acc, field) => {
          acc[field.id] = createFieldInstanceByVo(field);
          return acc;
        },
        {} as Record<string, IFieldInstance>
      )
    );

    const users = await this.prismaService
      .txClient()
      // eslint-disable-next-line @typescript-eslint/naming-convention
      .$queryRawUnsafe<{ id: string; email: string; name: string; avatar: string | null }[]>(
        nativeQuery
      );

    return users.map(({ id, email, name, avatar }) => ({
      userId: id,
      email,
      userName: name,
      avatar: avatar && getFullStorageUrl(StorageAdapter.getBucket(UploadType.Avatar), avatar),
    }));
  }

  async getViewAllCollaborators(shareInfo: IShareViewInfo) {
    const { tableId, view } = shareInfo;

    if (![ViewType.Form, ViewType.Kanban].includes(view.type)) {
      throw new ForbiddenException('view type is not allowed');
    }

    const fields = await this.fieldService.getFieldsByQuery(tableId, {
      viewId: view.id,
      filterHidden: !view.shareMeta?.includeHiddenField,
    });
    // If there is no user field, return an empty array
    if (
      !fields.some((field) =>
        [FieldType.User, FieldType.CreatedBy, FieldType.LastModifiedBy].includes(field.type)
      )
    ) {
      return [];
    }
    const { baseId } = await this.prismaService.txClient().tableMeta.findUniqueOrThrow({
      select: { baseId: true },
      where: { id: tableId },
    });
    const list = await this.collaboratorService.getListByBase(baseId);
    return list.map((item) => pick(item, 'userId', 'email', 'userName', 'avatar'));
  }
}
