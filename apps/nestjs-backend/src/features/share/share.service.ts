/* eslint-disable sonarjs/no-duplicate-string */
import { Injectable } from '@nestjs/common';
import type { IFieldVo, IViewVo } from '@teable/core';
import { FieldKeyType, HttpErrorCode, ViewType, isAnonymous } from '@teable/core';
import type {
  IShareViewCalendarDailyCollectionRo,
  ShareViewFormSubmitRo,
  ShareViewGetVo,
  IShareViewRowCountRo,
  IShareViewAggregationsRo,
  IShareViewRecordsRo,
  IShareViewCopyQuery,
  IShareViewGroupPointsRo,
  IAggregationVo,
  IGroupPointsVo,
  IRowCountVo,
  IShareViewLinkRecordsRo,
  IShareViewLinkRecordsVo,
  IRecordsVo,
  IShareViewCollaboratorsRo,
  IShareViewCollaboratorsVo,
  IShareViewSearchCountRo,
  IShareViewSearchIndexRo,
  IShareViewSearchCellCountRo,
  IShareViewSearchMatchesRo,
} from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import { CustomHttpException } from '../../custom.exception';
import type { IClsStore } from '../../types/cls';
import { convertViewVoAttachmentUrl } from '../../utils/convert-view-vo-attachment-url';
import { getPublicFullStorageUrl } from '../attachments/plugins/utils';
import { FieldOpenApiV2Service } from '../field/open-api/field-open-api-v2.service';
import { RecordOpenApiV2Service } from '../record/open-api/record-open-api-v2.service';
import { RecordOpenApiService } from '../record/open-api/record-open-api.service';
import { ViewOpenApiV2Service } from '../view/open-api/view-open-api-v2.service';
import type { IShareViewInfo } from './share-auth.service';
import { isLinkRecordSelectionQuery } from './share-link-query.util';
import {
  ShareSocketService,
  scopeSearchToVisibleFields,
  type IShareQueryFieldRefs,
} from './share-socket.service';
import { SharedViewRecordQueryV2Service } from './shared-view-record-query-v2.service';

export interface IJwtShareInfo {
  shareId: string;
  // sha256 over shareId + password (see hashSharePassword); never the password.
  pwHash: string;
}

// The share GET is the only share endpoint that echoes shareMeta to the visitor.
// The password must never be part of it (GHSA-w677-p6hx-85vw): the guard already
// answers 401 while it is missing, so the client has no use for the value.
const omitSharePassword = <T extends { password?: unknown }>(
  meta: T | undefined
): Omit<T, 'password'> | undefined => {
  if (!meta) return meta;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { password, ...rest } = meta;
  return rest;
};

const resolveShareRecordProjection = (
  fields: IFieldVo[],
  requestedProjection: string[] | undefined,
  keepPrimary: boolean
): string[] => {
  const allFieldIds = fields.map((field) => field.id);
  if (!requestedProjection?.length) return allFieldIds;

  const requestedFieldIds = new Set(requestedProjection);
  const requestedFields = fields.filter((field) => requestedFieldIds.has(field.id));

  // An empty projection means "all fields" downstream, so preserve the bounded
  // share scope when the client requested only hidden or otherwise unreadable fields.
  if (!requestedFields.length) return allFieldIds;
  if (!keepPrimary) return requestedFields.map((field) => field.id);

  return fields
    .filter((field) => field.isPrimary || requestedFieldIds.has(field.id))
    .map((field) => field.id);
};

const withScopedShareSearch = <T extends { search?: IShareQueryFieldRefs['search'] }>(
  query: T,
  visibleFieldIds: string[] | undefined
): T => {
  if (query.search === undefined) return query;
  const search = (scopeSearchToVisibleFields(query.search, visibleFieldIds) ??
    query.search) as T['search'];
  return {
    ...query,
    search,
  };
};

@Injectable()
export class ShareService {
  constructor(
    private readonly fieldOpenApiV2Service: FieldOpenApiV2Service,
    private readonly recordOpenApiService: RecordOpenApiService,
    private readonly recordOpenApiV2Service: RecordOpenApiV2Service,
    private readonly shareSocketService: ShareSocketService,
    private readonly viewOpenApiV2Service: ViewOpenApiV2Service,
    private readonly sharedViewRecordQueryV2Service: SharedViewRecordQueryV2Service,
    private readonly cls: ClsService<IClsStore>
  ) {}

  private isShareEditor(shareInfo: IShareViewInfo) {
    const userId = this.cls.get('user.id');
    return Boolean(shareInfo.shareMeta?.allowEdit && userId && !isAnonymous(userId));
  }

  private toPublicShareView(view: IViewVo): IViewVo {
    return convertViewVoAttachmentUrl({
      ...view,
      shareMeta: omitSharePassword(view.shareMeta),
    });
  }

  async getShareView(shareInfo: IShareViewInfo): Promise<ShareViewGetVo> {
    const { shareId, tableId, view, linkOptions, shareMeta } = shareInfo;
    const { filterByViewId, filter } = linkOptions ?? {};
    const viewId = filterByViewId ?? view?.id;
    const filteredFields = await this.getShareVisibleFields(shareInfo);

    let records: IRecordsVo['records'] = [];
    let extra: ShareViewGetVo['extra'];
    if (shareMeta?.includeRecords && filteredFields.length) {
      const recordsData = await this.recordOpenApiV2Service.getRecords(tableId, {
        viewId,
        skip: 0,
        take: 50,
        filter,
        groupBy: view?.group,
        fieldKeyType: FieldKeyType.Id,
        projection: filteredFields.map((field) => field.id),
      });
      records = recordsData.records;
      extra = recordsData.extra;
    }

    if (view?.type === ViewType.Plugin && viewId) {
      const pluginInstall = await this.viewOpenApiV2Service.getPluginInstall(tableId, viewId);
      const plugin = {
        pluginId: pluginInstall.pluginId,
        pluginInstallId: pluginInstall.pluginInstallId,
        name: pluginInstall.name,
        storage: pluginInstall.storage,
        url: pluginInstall.url,
      };
      if (extra) {
        extra.plugin = plugin;
      } else {
        extra = { plugin };
      }
    }

    return {
      shareMeta: omitSharePassword(shareMeta),
      shareId,
      tableId,
      viewId,
      view: view ? this.toPublicShareView(view) : undefined,
      fields: filteredFields,
      records,
      extra,
    };
  }

  /**
   * Bound a client-supplied share query to the fields the share exposes (see
   * ShareSocketService.assertQueryFieldsVisible). Every share read path must
   * call this before the query reaches the native record query:
   * the share context carries no authority matrix, so this is the only guard
   * against filter/group/sort/search on hidden columns. Returns the visible
   * field ids, or undefined when the share includes hidden fields.
   */
  async assertShareQueryFieldsVisible(
    shareInfo: IShareViewInfo,
    query: IShareQueryFieldRefs | undefined
  ): Promise<string[] | undefined> {
    return this.shareSocketService.assertQueryFieldsVisible(shareInfo, query);
  }

  async getViewAggregations(
    shareInfo: IShareViewInfo,
    query: IShareViewAggregationsRo = {}
  ): Promise<IAggregationVo> {
    const visibleFieldIds = await this.assertShareQueryFieldsVisible(shareInfo, query);
    if (query.search && visibleFieldIds && !visibleFieldIds.length) {
      return { aggregations: [] };
    }
    return this.sharedViewRecordQueryV2Service.getAggregations(
      shareInfo,
      withScopedShareSearch(query, visibleFieldIds)
    );
  }

  async getViewRowCount(
    shareInfo: IShareViewInfo,
    query?: IShareViewRowCountRo
  ): Promise<IRowCountVo> {
    const visibleFieldIds = await this.assertShareQueryFieldsVisible(shareInfo, query);
    if (query?.search && visibleFieldIds && !visibleFieldIds.length) {
      return { rowCount: 0 };
    }
    return this.sharedViewRecordQueryV2Service.getRowCount(
      shareInfo,
      query ? withScopedShareSearch(query, visibleFieldIds) : query
    );
  }

  async getViewRecords(
    shareInfo: IShareViewInfo,
    query?: IShareViewRecordsRo
  ): Promise<IRecordsVo> {
    const { tableId, view, linkOptions, shareMeta } = shareInfo;

    if (!shareMeta?.includeRecords) {
      return { records: [] };
    }

    const visibleFieldIds = await this.assertShareQueryFieldsVisible(shareInfo, query);
    if (query?.search && visibleFieldIds && !visibleFieldIds.length) {
      return { records: [] };
    }
    const { id, group } = view ?? {};
    const { filterByViewId, filter: linkFilter } = linkOptions ?? {};
    const viewId = filterByViewId ?? id;
    const shareVisibleFields = await this.getShareVisibleFields(shareInfo);
    const projection = resolveShareRecordProjection(
      shareVisibleFields,
      query?.projection,
      Boolean(linkOptions)
    );
    // An empty projection reads as "every field" downstream.
    if (!projection.length) {
      return { records: [] };
    }
    const isLinkSelectionQuery = Boolean(linkOptions) && isLinkRecordSelectionQuery(query);
    const filter = isLinkSelectionQuery ? undefined : (query?.filter ?? linkFilter);

    return this.recordOpenApiV2Service.getRecords(tableId, {
      viewId: isLinkSelectionQuery ? id : viewId,
      ignoreViewQuery: isLinkSelectionQuery || undefined,
      skip: query?.skip ?? 0,
      take: query?.take ?? 100,
      filter,
      orderBy: query?.orderBy,
      groupBy: query?.groupBy ?? group,
      fieldKeyType: FieldKeyType.Id,
      projection,
      search: scopeSearchToVisibleFields(query?.search, visibleFieldIds),
      filterLinkCellCandidate: query?.filterLinkCellCandidate,
      filterLinkCellSelected: query?.filterLinkCellSelected,
      selectedRecordIds: query?.selectedRecordIds,
    });
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

    if (this.cls.get('useV2')) {
      return this.recordOpenApiV2Service.formSubmit(
        tableId,
        formSubmitRo,
        includeHiddenField ? { shareId: shareInfo.shareId } : undefined
      );
    }

    return this.recordOpenApiService.formSubmit(tableId, formSubmitRo, { includeHiddenField });
  }

  async copy(shareInfo: IShareViewInfo, shareViewCopyRo: IShareViewCopyQuery) {
    if (!shareInfo.shareMeta?.allowCopy && !this.isShareEditor(shareInfo)) {
      throw new CustomHttpException('not allowed to copy', HttpErrorCode.RESTRICTED_RESOURCE, {
        localization: {
          i18nKey: 'httpErrors.share.notAllowedToCopy',
        },
      });
    }
    const visibleFieldIds = await this.assertShareQueryFieldsVisible(shareInfo, shareViewCopyRo);
    if (shareViewCopyRo.search && visibleFieldIds && !visibleFieldIds.length) {
      return { content: '', header: [] };
    }
    return this.sharedViewRecordQueryV2Service.getCopy(
      shareInfo,
      withScopedShareSearch(shareViewCopyRo, visibleFieldIds),
      this.isShareEditor(shareInfo)
    );
  }

  private async getShareVisibleFields(shareInfo: IShareViewInfo): Promise<IFieldVo[]> {
    const { tableId, view, linkOptions, shareMeta } = shareInfo;
    const { filterByViewId, visibleFieldIds } = linkOptions ?? {};
    const viewId = filterByViewId ?? view?.id;
    const fields = await this.fieldOpenApiV2Service.getFields(tableId, {
      viewId,
      filterHidden: Boolean(filterByViewId) || !shareMeta?.includeHiddenField,
    });
    return visibleFieldIds?.length
      ? fields.filter((field) => visibleFieldIds.includes(field.id) || field.isPrimary)
      : fields;
  }

  async getViewLinkRecords(
    shareInfo: IShareViewInfo,
    query: IShareViewLinkRecordsRo
  ): Promise<IShareViewLinkRecordsVo> {
    return this.sharedViewRecordQueryV2Service.getLinkRecords(shareInfo, query);
  }

  async getViewGroupPoints(
    shareInfo: IShareViewInfo,
    query: IShareViewGroupPointsRo = {}
  ): Promise<IGroupPointsVo> {
    const visibleFieldIds = await this.assertShareQueryFieldsVisible(shareInfo, query);
    if (query.search && visibleFieldIds && !visibleFieldIds.length) {
      return [];
    }
    return this.sharedViewRecordQueryV2Service.getGroupPoints(
      shareInfo,
      withScopedShareSearch(query, visibleFieldIds)
    );
  }

  async getViewCollaborators(
    shareInfo: IShareViewInfo,
    query: IShareViewCollaboratorsRo
  ): Promise<IShareViewCollaboratorsVo> {
    const collaborators = await this.sharedViewRecordQueryV2Service.getCollaborators(
      shareInfo,
      query,
      this.isShareEditor(shareInfo)
    );
    return collaborators.map((collaborator) => ({
      ...collaborator,
      avatar: collaborator.avatar
        ? getPublicFullStorageUrl(collaborator.avatar)
        : collaborator.avatar,
    }));
  }

  async getShareSearchCount(shareInfo: IShareViewInfo, query: IShareViewSearchCountRo) {
    const visibleFieldIds = await this.assertShareQueryFieldsVisible(shareInfo, query);
    if (query.search && visibleFieldIds && !visibleFieldIds.length) {
      return { count: 0 };
    }
    return this.sharedViewRecordQueryV2Service.getSearchCount(
      shareInfo,
      withScopedShareSearch(query, visibleFieldIds)
    );
  }

  async getShareSearchIndex(shareInfo: IShareViewInfo, query: IShareViewSearchIndexRo) {
    const visibleFieldIds = await this.assertShareQueryFieldsVisible(shareInfo, query);
    if (query.search && visibleFieldIds && !visibleFieldIds.length) {
      return null;
    }
    return this.sharedViewRecordQueryV2Service.getSearchIndex(
      shareInfo,
      withScopedShareSearch(query, visibleFieldIds)
    );
  }

  async getShareSearchCellCount(shareInfo: IShareViewInfo, query: IShareViewSearchCellCountRo) {
    const visibleFieldIds = await this.assertShareQueryFieldsVisible(shareInfo, query);
    return this.sharedViewRecordQueryV2Service.getSearchCellCount(
      shareInfo,
      query,
      visibleFieldIds
    );
  }

  async getShareSearchMatches(shareInfo: IShareViewInfo, query: IShareViewSearchMatchesRo) {
    const visibleFieldIds = await this.assertShareQueryFieldsVisible(shareInfo, query);
    return this.sharedViewRecordQueryV2Service.getSearchMatches(shareInfo, query, visibleFieldIds);
  }

  async getViewCalendarDailyCollection(
    shareInfo: IShareViewInfo,
    query: IShareViewCalendarDailyCollectionRo
  ) {
    if (!shareInfo.shareMeta?.includeRecords) return { countMap: {}, records: [] };
    const visibleFieldIds = await this.assertShareQueryFieldsVisible(shareInfo, query);
    if (query.search && visibleFieldIds && !visibleFieldIds.length) {
      return { countMap: {}, records: [] };
    }
    return this.sharedViewRecordQueryV2Service.getCalendarDailyCollection(
      shareInfo,
      withScopedShareSearch(query, visibleFieldIds)
    );
  }

  async buttonClick(shareInfo: IShareViewInfo, recordId: string, fieldId: string) {
    if (this.cls.get('useV2')) {
      const viewId = shareInfo.view?.id;
      if (!viewId) {
        throw new CustomHttpException('Shared view not found', HttpErrorCode.NOT_FOUND);
      }
      return this.recordOpenApiV2Service.buttonClick(shareInfo.tableId, recordId, fieldId, {
        viewId,
        includeHiddenFields: Boolean(shareInfo.shareMeta?.includeHiddenField),
        includeRecords: Boolean(shareInfo.shareMeta?.includeRecords),
      });
    }
    await this.shareSocketService.validFieldSnapshotPermission(shareInfo, [fieldId]);
    await this.shareSocketService.validRecordSnapshotPermission(shareInfo, [recordId]);
    return this.recordOpenApiService.buttonClick(shareInfo.tableId, recordId, fieldId);
  }
}
