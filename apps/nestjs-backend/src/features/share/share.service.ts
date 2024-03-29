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
import { FieldKeyType, FieldType, ViewType, contains } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type {
  ShareViewFormSubmitRo,
  ShareViewGetVo,
  IShareViewRowCountRo,
  IShareViewAggregationsRo,
  IRangesRo,
  IShareViewGroupPointsRo,
  IAggregationVo,
  IGroupPointsVo,
  IRowCountVo,
  IShareViewLinkRecordsRo,
  IRecordsVo,
  IShareViewCollaboratorsRo,
} from '@teable/openapi';
import { Knex } from 'knex';
import { pick } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import { getFullStorageUrl } from '../../utils/full-storage-url';
import { AggregationService } from '../aggregation/aggregation.service';
import { CollaboratorService } from '../collaborator/collaborator.service';
import { FieldService } from '../field/field.service';
import type { IFieldInstance } from '../field/model/factory';
import { createFieldInstanceByVo } from '../field/model/factory';
import { RecordOpenApiService } from '../record/open-api/record-open-api.service';
import { RecordService } from '../record/record.service';
import { SelectionService } from '../selection/selection.service';
import { createViewVoByRaw } from '../view/model/factory';

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
    const { tableId, id: viewId } = view;
    const fields = await this.fieldService.getFieldsByQuery(tableId, {
      viewId: view.id,
      filterHidden: !shareMeta?.includeHiddenField,
    });
    const { records } = await this.recordService.getRecords(tableId, {
      viewId,
      skip: 0,
      take: 50,
      fieldKeyType: FieldKeyType.Id,
      projection: fields.map((f) => f.id),
    });
    return {
      shareMeta,
      shareId,
      tableId,
      viewId,
      view: createViewVoByRaw(view),
      fields,
      records,
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
    const { tableId } = shareInfo;
    const { fields } = shareViewFormSubmitRo;
    const { records } = await this.prismaService.$tx(async () => {
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
    return this.selectionService.copy(shareInfo.tableId, {
      viewId: shareInfo.view.id,
      ...shareViewCopyRo,
    });
  }

  private async preCheckFieldHidden(view: IViewVo, fieldId: string) {
    // hidden check
    if (
      !view.shareMeta?.includeHiddenField &&
      (view.columnMeta[fieldId] as { hidden?: boolean })?.hidden
    ) {
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

    const linkField = await this.fieldService.getField(foreignTableId, lookupFieldId);

    let filter: IFilter | undefined;
    if (search) {
      filter = {
        filterSet: [
          {
            fieldId: lookupFieldId,
            value: search,
            operator: contains.value,
          },
        ],
        conjunction: 'and',
      };
    }
    return this.recordService.getRecords(foreignTableId, {
      take,
      skip,
      filter,
      projection: [linkField.id],
      fieldKeyType: FieldKeyType.Id,
      filterLinkCellCandidate: field.id,
    });
  }

  async getViewFilterLinkRecords(field: IFieldVo, query: IShareViewLinkRecordsRo) {
    const { fieldId, skip, take, search } = query;

    const { foreignTableId, lookupFieldId } = field.options as ILinkFieldOptions;
    let filter: IFilter | undefined;
    if (search) {
      filter = {
        filterSet: [
          {
            fieldId: lookupFieldId,
            value: search,
            operator: contains.value,
          },
        ],
        conjunction: 'and',
      };
    }
    return this.recordService.getRecords(foreignTableId, {
      skip,
      take,
      filter,
      fieldKeyType: FieldKeyType.Id,
      projection: [lookupFieldId],
      filterLinkCellCandidate: fieldId,
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

    await this.preCheckFieldHidden(view, fieldId);

    // user field check
    const field = await this.fieldService.getField(tableId, fieldId);
    // All user field, contains lastModifiedBy, createdBy
    if (field.type !== FieldType.User) {
      throw new ForbiddenException('field type is not user field');
    }

    if (view.type === ViewType.Form) {
      return this.getViewFormCollaborators(shareInfo);
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

    console.log('sql query ===', nativeQuery);

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
      avatar: avatar && getFullStorageUrl(avatar),
    }));
  }

  async getViewFormCollaborators(shareInfo: IShareViewInfo) {
    const { tableId, view } = shareInfo;

    if (view.type !== ViewType.Form) {
      throw new ForbiddenException('view type is not allowed');
    }

    const fields = await this.fieldService.getFieldsByQuery(tableId, {
      viewId: view.id,
      filterHidden: !view.shareMeta?.includeHiddenField,
    });
    // If there is no user field, return an empty array
    if (!fields.some((field) => field.type === FieldType.User)) {
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
