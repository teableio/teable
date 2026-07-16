/* eslint-disable sonarjs/no-duplicate-string */
import { Injectable } from '@nestjs/common';
import type { IFilter, IFieldVo, IViewVo, ILinkFieldOptions, StatisticsFunc } from '@teable/core';
import {
  CellFormat,
  FieldKeyType,
  FieldType,
  HttpErrorCode,
  ViewType,
  isAnonymous,
} from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { ShareViewLinkRecordsType, PluginPosition } from '@teable/openapi';
import type {
  IShareViewCalendarDailyCollectionRo,
  ShareViewFormSubmitRo,
  ShareViewGetVo,
  IShareViewRowCountRo,
  IShareViewAggregationsRo,
  IShareViewRecordsRo,
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
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import { CustomHttpException } from '../../custom.exception';
import { InjectDbProvider } from '../../db-provider/db.provider';
import { IDbProvider } from '../../db-provider/db.provider.interface';
import { DatabaseRouter } from '../../global/database-router.service';
import { DATA_KNEX } from '../../global/knex/knex.module';
import type { IClsStore } from '../../types/cls';
import { convertViewVoAttachmentUrl } from '../../utils/convert-view-vo-attachment-url';
import { isNotHiddenField } from '../../utils/is-not-hidden-field';
import { IAggregationService } from '../aggregation/aggregation.service.interface';
import { InjectAggregationService } from '../aggregation/aggregation.service.provider';
import { getPublicFullStorageUrl } from '../attachments/plugins/utils';
import { CollaboratorService } from '../collaborator/collaborator.service';
import { FieldService } from '../field/field.service';
import type { IFieldInstance } from '../field/model/factory';
import { createFieldInstanceByVo } from '../field/model/factory';
import { RecordOpenApiV2Service } from '../record/open-api/record-open-api-v2.service';
import { RecordOpenApiService } from '../record/open-api/record-open-api.service';
import { RecordService } from '../record/record.service';
import { SelectionService } from '../selection/selection.service';
import type { IShareViewInfo } from './share-auth.service';
import { isLinkRecordSelectionQuery } from './share-link-query.util';
import { ShareSocketService } from './share-socket.service';

export interface IJwtShareInfo {
  shareId: string;
  password: string;
}

@Injectable()
export class ShareService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly databaseRouter: DatabaseRouter,
    private readonly fieldService: FieldService,
    private readonly recordService: RecordService,
    @InjectAggregationService() private readonly aggregationService: IAggregationService,
    private readonly recordOpenApiService: RecordOpenApiService,
    private readonly recordOpenApiV2Service: RecordOpenApiV2Service,
    private readonly selectionService: SelectionService,
    private readonly collaboratorService: CollaboratorService,
    private readonly shareSocketService: ShareSocketService,
    private readonly cls: ClsService<IClsStore>,
    @InjectDbProvider() private readonly dbProvider: IDbProvider,
    @InjectModel(DATA_KNEX) private readonly knex: Knex
  ) {}

  private isShareEditor(shareInfo: IShareViewInfo) {
    const userId = this.cls.get('user.id');
    return Boolean(shareInfo.shareMeta?.allowEdit && userId && !isAnonymous(userId));
  }

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
      const recordsData = await this.recordService.getRecords(
        tableId,
        {
          viewId,
          skip: 0,
          take: 50,
          filter,
          groupBy: group,
          fieldKeyType: FieldKeyType.Id,
          projection: filteredFields.map((f) => f.id),
        },
        true
      );
      records = recordsData.records;
      extra = recordsData.extra;
    }

    if (view?.type === ViewType.Plugin && viewId) {
      const pluginInstall = await this.prismaService.pluginInstall.findFirst({
        where: { positionId: viewId, position: PluginPosition.View },
        select: {
          id: true,
          pluginId: true,
          name: true,
          storage: true,
          plugin: {
            select: { url: true },
          },
        },
      });
      if (!pluginInstall) {
        throw new CustomHttpException('Plugin install not found', HttpErrorCode.NOT_FOUND, {
          localization: {
            i18nKey: 'httpErrors.pluginInstall.notFound',
          },
        });
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
      view: view ? convertViewVoAttachmentUrl(view) : undefined,
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
          // check field hidden: guard on the aggregated fieldId, not the
          // statistic func key — passing the func would never match a column
          // and silently leak hidden-column aggregates to share visitors
          if (shareInfo.view) {
            this.preCheckFieldHidden(shareInfo.view as IViewVo, fieldId);
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
      useQueryModel: true,
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
    const { filterByViewId } = linkOptions ?? {};
    const tableId = shareInfo.tableId;
    // The link field's view scope (filterByViewId)/filter only constrains which records
    // can be newly linked (the candidate list). Queries that load already-linked records
    // (filterLinkCellSelected or explicit selectedRecordIds) must count them in full,
    // even when they fall outside that view — otherwise an already-linked record outside
    // the configured view reports rowCount 0. T4864.
    const isLinkSelectionQuery = Boolean(linkOptions) && isLinkRecordSelectionQuery(query);
    const viewId = isLinkSelectionQuery ? id : filterByViewId ?? id;
    const filter = isLinkSelectionQuery ? undefined : linkOptions?.filter ?? query?.filter;
    const result = await this.aggregationService.performRowCount(tableId, {
      ...query,
      viewId,
      filter,
    });

    return {
      rowCount: result.rowCount,
    };
  }

  async getViewRecords(
    shareInfo: IShareViewInfo,
    query?: IShareViewRecordsRo
  ): Promise<IRecordsVo> {
    const { tableId, view, linkOptions, shareMeta } = shareInfo;

    if (!shareMeta?.includeRecords) {
      return { records: [] };
    }

    const { id, group } = view ?? {};
    const { filterByViewId, filter: linkFilter } = linkOptions ?? {};
    const viewId = filterByViewId ?? id;

    // A client-supplied projection must never widen the share's field scope:
    // intersect it with the visible fields so a crafted projection cannot read
    // hidden columns (the default projection already lists only visible fields).
    const shareVisibleFieldIds = await this.getShareVisibleFieldIds(shareInfo);
    const visibleFieldIdSet = new Set(shareVisibleFieldIds);
    const requestedFieldIds = query?.projection?.length
      ? query.projection.filter((fieldId) => visibleFieldIdSet.has(fieldId))
      : shareVisibleFieldIds;
    // Fall back to the full visible set when a (crafted) projection requested
    // only hidden fields: an empty projection is read downstream as "all
    // fields", which would leak every column.
    const projection = requestedFieldIds.length ? requestedFieldIds : shareVisibleFieldIds;

    // Queries that load already-linked records (filterLinkCellSelected or explicit
    // selectedRecordIds) must return them in full, even when they fall outside the link
    // field's view scope — otherwise an already-linked record outside the configured
    // view renders blank. The view scope/filter only constrains the candidate list. T4864.
    const isLinkSelectionQuery = Boolean(linkOptions) && isLinkRecordSelectionQuery(query);
    const filter = isLinkSelectionQuery ? undefined : query?.filter ?? linkFilter;

    return await this.recordService.getRecords(
      tableId,
      {
        viewId: isLinkSelectionQuery ? id : viewId,
        skip: query?.skip ?? 0,
        take: query?.take ?? 100,
        filter,
        orderBy: query?.orderBy,
        groupBy: query?.groupBy ?? group,
        fieldKeyType: FieldKeyType.Id,
        projection,
        search: query?.search,
        filterLinkCellCandidate: query?.filterLinkCellCandidate,
        filterLinkCellSelected: query?.filterLinkCellSelected,
        selectedRecordIds: query?.selectedRecordIds,
      },
      true
    );
  }

  async formSubmit(shareInfo: IShareViewInfo, shareViewFormSubmitRo: ShareViewFormSubmitRo) {
    const { tableId, view } = shareInfo;
    const { fields, typecast } = shareViewFormSubmitRo;
    if (!view) {
      throw new CustomHttpException('view is required', HttpErrorCode.RESTRICTED_RESOURCE, {
        localization: {
          i18nKey: 'httpErrors.share.viewRequired',
        },
      });
    }
    if (view.type !== ViewType.Form) {
      throw new CustomHttpException('not allowed to submit', HttpErrorCode.RESTRICTED_RESOURCE, {
        localization: {
          i18nKey: 'httpErrors.share.notAllowedToSubmit',
        },
      });
    }

    const formSubmitRo = { viewId: view.id, fields, typecast };
    const includeHiddenField = Boolean(view.shareMeta?.includeHiddenField);

    // V2 form validation rejects hidden fields. Until SubmitRecord supports
    // share includeHiddenField, keep the V1 path so existing share semantics hold.
    if (this.cls.get('useV2') && includeHiddenField) {
      this.cls.set('useV2', false);
      this.cls.set('v2Reason', 'unsupported_feature');
    }

    if (this.cls.get('useV2')) {
      return this.recordOpenApiV2Service.formSubmit(tableId, formSubmitRo);
    }

    return this.recordOpenApiService.formSubmit(tableId, formSubmitRo, { includeHiddenField });
  }

  async copy(shareInfo: IShareViewInfo, shareViewCopyRo: IRangesRo) {
    // allowEdit implies allowCopy — viewers that can write the data can
    // already read every value, so blocking clipboard copy is only friction.
    const copyAllowed = shareInfo.shareMeta?.allowCopy || this.isShareEditor(shareInfo);
    if (!copyAllowed) {
      throw new CustomHttpException('not allowed to copy', HttpErrorCode.RESTRICTED_RESOURCE, {
        localization: {
          i18nKey: 'httpErrors.share.notAllowedToCopy',
        },
      });
    }

    return this.selectionService.copy(shareInfo.tableId, {
      viewId: shareInfo.view?.id,
      ...shareViewCopyRo,
    });
  }

  // The field ids a share visitor is allowed to read: the view's non-hidden
  // fields (or, for a link share, its configured visibleFieldIds plus primary).
  // Used to bound any client-supplied projection so hidden columns never leak —
  // the share context carries no authority matrix, so this is the only column
  // guard for the records/calendar read paths.
  private async getShareVisibleFieldIds(shareInfo: IShareViewInfo): Promise<string[]> {
    const { tableId, view, linkOptions, shareMeta } = shareInfo;
    const { filterByViewId, visibleFieldIds } = linkOptions ?? {};
    const viewId = filterByViewId ?? view?.id;
    const fields = await this.fieldService.getFieldsByQuery(tableId, {
      viewId,
      filterHidden: Boolean(filterByViewId) || !shareMeta?.includeHiddenField,
    });
    const filtered = visibleFieldIds?.length
      ? fields.filter((f) => visibleFieldIds.includes(f.id) || f.isPrimary)
      : fields;
    return filtered.map((f) => f.id);
  }

  private preCheckFieldHidden(view: IViewVo, fieldId: string) {
    // hidden check
    if (!view.shareMeta?.includeHiddenField && !isNotHiddenField(fieldId, view)) {
      throw new CustomHttpException(
        'field is hidden, not allowed',
        HttpErrorCode.RESTRICTED_RESOURCE,
        {
          localization: {
            i18nKey: 'httpErrors.share.fieldHiddenNotAllowed',
          },
        }
      );
    }
  }

  async getViewLinkRecords(shareInfo: IShareViewInfo, query: IShareViewLinkRecordsRo) {
    const { tableId, view } = shareInfo;
    const { fieldId } = query;
    if (!view) {
      throw new CustomHttpException('view is required', HttpErrorCode.NOT_FOUND, {
        localization: {
          i18nKey: 'httpErrors.share.viewRequired',
        },
      });
    }

    this.preCheckFieldHidden(view as IViewVo, fieldId);

    // link field check
    const field = await this.fieldService.getField(tableId, fieldId);
    if (field.type !== FieldType.Link) {
      throw new CustomHttpException(
        'Field type is not link field',
        HttpErrorCode.RESTRICTED_RESOURCE,
        {
          localization: {
            i18nKey: 'httpErrors.share.fieldTypeNotLinkField',
          },
        }
      );
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
    return recordsVo.records.map(({ id, name, fields }) => {
      const lookupFieldId = (field.options as ILinkFieldOptions).lookupFieldId;
      const title = lookupFieldId ? (fields[lookupFieldId] as string) : name;
      return { id, title };
    });
  }

  async getFormLinkRecords(field: IFieldVo, query: IShareViewLinkRecordsRo) {
    const { lookupFieldId, foreignTableId, filter, filterByViewId } =
      field.options as ILinkFieldOptions;
    const { take, skip, search } = query;

    return this.recordService.getRecords(
      foreignTableId,
      {
        viewId: filterByViewId ?? undefined,
        filter,
        take,
        skip,
        search: search ? [search, lookupFieldId, true] : undefined,
        projection: [lookupFieldId],
        fieldKeyType: FieldKeyType.Id,
        filterLinkCellCandidate: field.id,
        cellFormat: CellFormat.Text,
      },
      true
    );
  }

  async getViewFilterLinkRecords(field: IFieldVo, query: IShareViewLinkRecordsRo) {
    const { fieldId, skip, take, search } = query;

    const { foreignTableId, lookupFieldId } = field.options as ILinkFieldOptions;

    return this.recordService.getRecords(
      foreignTableId,
      {
        skip,
        take,
        search: search ? [search, lookupFieldId, true] : undefined,
        fieldKeyType: FieldKeyType.Id,
        projection: [lookupFieldId],
        filterLinkCellSelected: fieldId,
        cellFormat: CellFormat.Text,
      },
      true
    );
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
      return this.getViewAllCollaborators(shareInfo, query);
    }

    // only form, kanban and plugin view can get all collaborators
    if ([ViewType.Form, ViewType.Kanban, ViewType.Plugin].includes(view.type)) {
      return this.getViewAllCollaborators(shareInfo, query);
    }

    // share-edit links need the full base collaborator pool so external editors
    // can assign any member to a user field, just like base collaborators can.
    // Read-only shares stay narrow (only users already referenced in the field)
    // to avoid leaking the member directory to anonymous viewers.
    if (this.isShareEditor(shareInfo)) {
      return this.getViewAllCollaborators(shareInfo, query);
    }

    if (!fieldId) {
      throw new CustomHttpException('fieldId is required', HttpErrorCode.VALIDATION_ERROR, {
        localization: {
          i18nKey: 'httpErrors.share.fieldIdRequired',
        },
      });
    }

    await this.preCheckFieldHidden(view as IViewVo, fieldId);

    // user field check
    const field = await this.fieldService.getField(tableId, fieldId);
    // All user field, contains lastModifiedBy, createdBy
    if (![FieldType.User, FieldType.LastModifiedBy, FieldType.CreatedBy].includes(field.type)) {
      throw new CustomHttpException(
        'field type is not user-related field',
        HttpErrorCode.RESTRICTED_RESOURCE,
        {
          localization: {
            i18nKey: 'httpErrors.share.fieldNotUserRelatedField',
          },
        }
      );
    }

    return this.getViewFilterCollaborators(shareInfo, field, query);
  }

  private async getViewFilterUserIds(
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
    const nativeQuery = queryBuilder.toQuery();
    const rows = await this.databaseRouter.queryDataPrismaForTable<
      Record<'user_id', string | null>[]
    >(tableId, nativeQuery);

    return Array.from(
      new Set(
        rows.map((row) => row['user_id']).filter((userId): userId is string => Boolean(userId))
      )
    );
  }

  async getViewFilterCollaborators(
    shareInfo: IShareViewInfo,
    field: IFieldVo,
    query?: { skip?: number; take?: number; search?: string }
  ) {
    const { tableId, view } = shareInfo;
    const { skip = 0, take = 50, search } = query ?? {};
    if (!view) {
      throw new CustomHttpException('view is required', HttpErrorCode.RESTRICTED_RESOURCE, {
        localization: {
          i18nKey: 'httpErrors.share.viewRequired',
        },
      });
    }

    const fields = await this.fieldService.getFieldsByQuery(tableId, {
      viewId: view.id,
    });

    const userIds = await this.getViewFilterUserIds(
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

    if (!userIds.length) {
      return [];
    }

    const users = await this.prismaService.user.findMany({
      where: {
        id: { in: userIds },
        // Match by name only: searching by email would let anonymous viewers
        // probe membership by email even though email is not returned.
        ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
      },
      select: {
        id: true,
        name: true,
        avatar: true,
      },
      skip,
      take,
    });

    // Email is intentionally omitted from share responses to avoid leaking the
    // member directory to anonymous viewers. Picker selection is by id.
    return users.map(({ id, name, avatar }) => ({
      userId: id,
      userName: name,
      avatar: avatar && getPublicFullStorageUrl(avatar),
    }));
  }

  async getViewAllCollaborators(
    shareInfo: IShareViewInfo,
    query?: { skip?: number; take?: number; search?: string; fieldId?: string }
  ) {
    const { skip = 0, take = 50, search } = query ?? {};
    const { tableId, view } = shareInfo;

    if (
      view &&
      !this.isShareEditor(shareInfo) &&
      ![ViewType.Form, ViewType.Kanban, ViewType.Plugin].includes(view.type)
    ) {
      throw new CustomHttpException('view type is not allowed', HttpErrorCode.RESTRICTED_RESOURCE, {
        localization: {
          i18nKey: 'httpErrors.share.viewTypeNotAllowed',
        },
      });
    }

    let fields = await this.fieldService.getFieldsByQuery(tableId, {
      viewId: view?.id,
      filterHidden: !view?.shareMeta?.includeHiddenField,
    });
    if (query?.fieldId) {
      fields = fields.filter((field) => field.id === query.fieldId);
    }
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
    const list = await this.collaboratorService.getUserCollaborators(baseId, {
      skip,
      take,
      search,
      // Anonymous share views must not allow probing membership by email.
      searchByEmail: false,
    });
    // Email is intentionally omitted from share responses to avoid leaking the
    // member directory to anonymous viewers. Picker selection is by id.
    return list.map((item) => ({
      userId: item.id,
      userName: item.name,
      avatar: item.avatar,
    }));
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
    const result = await this.aggregationService.getCalendarDailyCollection(shareInfo.tableId, {
      ...query,
      viewId: shareInfo.view?.id,
    });
    // The daily collection returns full record snapshots; restrict them to the
    // share's visible fields so hidden columns are not leaked to the visitor.
    const visibleFieldIds = new Set(await this.getShareVisibleFieldIds(shareInfo));
    return {
      ...result,
      records: result.records.map((record) => ({
        ...record,
        fields: Object.fromEntries(
          Object.entries(record.fields).filter(([fieldId]) => visibleFieldIds.has(fieldId))
        ),
      })),
    };
  }

  async buttonClick(shareInfo: IShareViewInfo, recordId: string, fieldId: string) {
    await this.shareSocketService.validFieldSnapshotPermission(shareInfo, [fieldId]);
    await this.shareSocketService.validRecordSnapshotPermission(shareInfo, [recordId]);
    return this.recordOpenApiService.buttonClick(shareInfo.tableId, recordId, fieldId);
  }
}
