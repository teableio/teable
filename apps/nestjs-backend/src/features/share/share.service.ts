/* eslint-disable sonarjs/no-duplicate-string */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { IFilter, IFieldVo, IViewVo, ILinkFieldOptions, StatisticsFunc } from '@teable/core';
import { FieldKeyType, FieldType, ViewType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { UploadType, ShareViewLinkRecordsType, PluginPosition } from '@teable/openapi';
import type {
  IShareViewCalendarDailyCollectionRo,
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
  ISearchCountRo,
  ISearchIndexByQueryRo,
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
import { ViewService } from '../view/view.service';
import type { IShareViewInfo } from './share-auth.service';

export interface IJwtShareInfo {
  shareId: string;
  password: string;
}

@Injectable()
export class ShareService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly viewService: ViewService,
    private readonly fieldService: FieldService,
    private readonly recordService: RecordService,
    private readonly aggregationService: AggregationService,
    private readonly recordOpenApiService: RecordOpenApiService,
    private readonly selectionService: SelectionService,
    private readonly collaboratorService: CollaboratorService,
    private readonly cls: ClsService<IClsStore>,
    @InjectDbProvider() private readonly dbProvider: IDbProvider,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex
  ) {}

  async getShareView(shareInfo: IShareViewInfo): Promise<ShareViewGetVo> {
    const { shareId, tableId, view, linkOptions, shareMeta } = shareInfo;
    const { id, group } = view ?? {};
    const { filterByViewId, filter, visibleFieldIds } = linkOptions ?? {};
    const viewId = filterByViewId ?? id;

    const fields = await this.fieldService.getFieldsByQuery(tableId, {
      viewId,
      filterHidden: Boolean(filterByViewId) || !shareMeta?.includeHiddenField,
    });
    const filteredFields = visibleFieldIds?.length
      ? fields.filter((f) => visibleFieldIds?.includes(f.id) || f.isPrimary)
      : fields;

    let records: IRecordsVo['records'] = [];
    let extra: ShareViewGetVo['extra'];
    if (shareMeta?.includeRecords) {
      const recordsData = await this.recordService.getRecords(tableId, {
        viewId,
        skip: 0,
        take: 50,
        filter,
        groupBy: group,
        fieldKeyType: FieldKeyType.Id,
        projection: filteredFields.map((f) => f.id),
      });
      records = recordsData.records;
      extra = recordsData.extra;
    }

    if (view?.type === ViewType.Plugin) {
      const pluginInstall = await this.prismaService.pluginInstall.findFirst({
        where: { positionId: viewId, position: PluginPosition.View },
        select: {
          id: true,
          pluginId: true,
          name: true,
          storage: true,
          plugin: {
            select: {
              url: true,
            },
          },
        },
      });
      if (!pluginInstall) {
        throw new NotFoundException(`Plugin install not found`);
      }
      const plugin = {
        pluginId: pluginInstall.pluginId,
        pluginInstallId: pluginInstall.id,
        name: pluginInstall.name,
        storage: pluginInstall.storage ? JSON.parse(pluginInstall.storage) : undefined,
        url: pluginInstall.plugin.url || undefined,
      };
      if (extra) {
        extra.plugin = plugin;
      } else {
        extra = { plugin: plugin };
      }
    }

    return {
      shareMeta,
      shareId,
      tableId,
      viewId,
      view: view ? this.viewService.convertViewVoAttachmentUrl(view) : undefined,
      fields: filteredFields,
      records,
      extra,
    };
  }

  async getViewAggregations(
    shareInfo: IShareViewInfo,
    query: IShareViewAggregationsRo = {}
  ): Promise<IAggregationVo> {
    const { tableId, shareMeta } = shareInfo;
    if (!shareMeta?.includeRecords) {
      return { aggregations: [] };
    }
    const viewId = shareInfo.view?.id;
    const filter = query?.filter ?? null;
    const groupBy = query?.groupBy ?? null;
    const fieldStats: Array<{ fieldId: string; statisticFunc: StatisticsFunc }> = [];
    if (query?.field) {
      Object.entries(query.field).forEach(([key, value]) => {
        const stats = value.map((fieldId) => {
          // check field hidden
          if (shareInfo.view) {
            this.preCheckFieldHidden(shareInfo.view as IViewVo, key);
          }
          return {
            fieldId,
            statisticFunc: key as StatisticsFunc,
          };
        });
        fieldStats.push(...stats);
      });
    }
    const result = await this.aggregationService.performAggregation({
      tableId,
      withView: { viewId, customFilter: filter, customFieldStats: fieldStats, groupBy },
    });

    return { aggregations: result?.aggregations };
  }

  async getViewRowCount(
    shareInfo: IShareViewInfo,
    query?: IShareViewRowCountRo
  ): Promise<IRowCountVo> {
    const { view, linkOptions, shareMeta } = shareInfo;

    if (!shareMeta?.includeRecords) {
      return { rowCount: 0 };
    }

    const { id } = view ?? {};
    const { filterByViewId, filter } = linkOptions ?? {};
    const viewId = filterByViewId ?? id;
    const tableId = shareInfo.tableId;
    const result = await this.aggregationService.performRowCount(tableId, {
      viewId,
      filter,
      ...query,
    });

    return {
      rowCount: result.rowCount,
    };
  }

  async formSubmit(shareInfo: IShareViewInfo, shareViewFormSubmitRo: ShareViewFormSubmitRo) {
    const { tableId, view, shareMeta } = shareInfo;
    const { fields, typecast } = shareViewFormSubmitRo;
    if (!shareMeta?.submit?.allow) {
      throw new ForbiddenException('not allowed to submit');
    }
    if (!view) {
      throw new ForbiddenException('view is required');
    }

    const viewId = view.id;

    // check field hidden
    const visibleFields = await this.fieldService.getFieldsByQuery(tableId, {
      viewId,
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
      this.cls.set('entry', { type: 'form', id: viewId });
      return this.recordOpenApiService.createRecords(tableId, {
        records: [{ fields }],
        fieldKeyType: FieldKeyType.Id,
        typecast,
      });
    });
    if (records.length === 0) {
      throw new InternalServerErrorException('The number of successful submit records is 0');
    }
    return records[0];
  }

  async copy(shareInfo: IShareViewInfo, shareViewCopyRo: IRangesRo) {
    if (!shareInfo.shareMeta?.allowCopy) {
      throw new ForbiddenException('not allowed to copy');
    }

    return this.selectionService.copy(shareInfo.tableId, {
      viewId: shareInfo.view?.id,
      ...shareViewCopyRo,
    });
  }

  private preCheckFieldHidden(view: IViewVo, fieldId: string) {
    // hidden check
    if (!view.shareMeta?.includeHiddenField && !isNotHiddenField(fieldId, view)) {
      throw new ForbiddenException('field is hidden, not allowed');
    }
  }

  async getViewLinkRecords(shareInfo: IShareViewInfo, query: IShareViewLinkRecordsRo) {
    const { tableId, view } = shareInfo;
    const { fieldId } = query;
    if (!view) {
      throw new ForbiddenException('view is required');
    }

    this.preCheckFieldHidden(view as IViewVo, fieldId);

    // link field check
    const field = await this.fieldService.getField(tableId, fieldId);
    if (field.type !== FieldType.Link) {
      throw new ForbiddenException('field type is not link field');
    }

    let recordsVo: IRecordsVo;
    if (view.type === ViewType.Form) {
      recordsVo = await this.getFormLinkRecords(field, query);
    } else if (view.type === ViewType.Plugin) {
      recordsVo =
        query.type === ShareViewLinkRecordsType.Candidate
          ? await this.getFormLinkRecords(field, query)
          : await this.getViewFilterLinkRecords(field, query);
    } else {
      recordsVo = await this.getViewFilterLinkRecords(field, query);
    }
    return recordsVo.records.map(({ id, name }) => ({ id, title: name }));
  }

  async getFormLinkRecords(field: IFieldVo, query: IShareViewLinkRecordsRo) {
    const { lookupFieldId, foreignTableId, filter, filterByViewId } =
      field.options as ILinkFieldOptions;
    const { take, skip, search } = query;

    return this.recordService.getRecords(foreignTableId, {
      viewId: filterByViewId ?? undefined,
      filter,
      take,
      skip,
      search: search ? [search, lookupFieldId, true] : undefined,
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
      search: search ? [search, lookupFieldId, true] : undefined,
      fieldKeyType: FieldKeyType.Id,
      projection: [lookupFieldId],
      filterLinkCellSelected: fieldId,
    });
  }

  async getViewGroupPoints(
    shareInfo: IShareViewInfo,
    query?: IShareViewGroupPointsRo
  ): Promise<IGroupPointsVo> {
    if (!shareInfo.shareMeta?.includeRecords) {
      return [];
    }
    const viewId = shareInfo.view?.id;
    const tableId = shareInfo.tableId;
    const view = shareInfo.view;
    if (viewId == null) return null;

    if (view) {
      query?.groupBy?.forEach(({ fieldId }) => {
        this.preCheckFieldHidden(view, fieldId);
      });
    }

    return this.aggregationService.getGroupPoints(tableId, { ...query, viewId });
  }

  async getViewCollaborators(shareInfo: IShareViewInfo, query: IShareViewCollaboratorsRo) {
    const { view, tableId } = shareInfo;
    const { fieldId } = query;

    if (!view) {
      return this.getViewAllCollaborators(shareInfo);
    }

    // only form, kanban and plugin view can get all collaborators
    if ([ViewType.Form, ViewType.Kanban, ViewType.Plugin].includes(view.type)) {
      return this.getViewAllCollaborators(shareInfo);
    }

    if (!fieldId) {
      throw new BadRequestException('fieldId is required');
    }

    await this.preCheckFieldHidden(view as IViewVo, fieldId);

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
    if (!view) {
      throw new ForbiddenException('view is required');
    }

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

    if (view && ![ViewType.Form, ViewType.Kanban, ViewType.Plugin].includes(view.type)) {
      throw new ForbiddenException('view type is not allowed');
    }

    const fields = await this.fieldService.getFieldsByQuery(tableId, {
      viewId: view?.id,
      filterHidden: !view?.shareMeta?.includeHiddenField,
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

  async getShareSearchCount(tableId: string, query: ISearchCountRo) {
    return this.aggregationService.getSearchCount(tableId, query);
  }

  async getShareSearchIndex(tableId: string, query: ISearchIndexByQueryRo) {
    return this.aggregationService.getRecordIndexBySearchOrder(tableId, query);
  }

  async getViewCalendarDailyCollection(
    shareInfo: IShareViewInfo,
    query: IShareViewCalendarDailyCollectionRo
  ) {
    return this.aggregationService.getCalendarDailyCollection(shareInfo.tableId, {
      ...query,
      viewId: shareInfo.view?.id,
    });
  }
}
