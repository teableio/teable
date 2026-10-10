import { Injectable } from '@nestjs/common';
import { HttpErrorCode, isFieldReferenceValue } from '@teable/core';
import type {
  IFieldVo,
  IFilter,
  IFilterItem,
  IGroup,
  ISortItem,
  IGetFieldsQuery,
} from '@teable/core';
import type { IGetRecordsRo, IShareViewRecordsRo } from '@teable/openapi';
import { difference, isEqual } from 'lodash';
import { ClsService } from 'nestjs-cls';
import { CustomHttpException } from '../../custom.exception';
import type { IClsStore } from '../../types/cls';
import { FieldService } from '../field/field.service';
import { FieldOpenApiV2Service } from '../field/open-api/field-open-api-v2.service';
import { RecordOpenApiV2Service } from '../record/open-api/record-open-api-v2.service';
import { RecordService } from '../record/record.service';
import { ViewOpenApiV2Service } from '../view/open-api/view-open-api-v2.service';
import { ViewService } from '../view/view.service';
import type { IShareViewInfo } from './share-auth.service';
import { isLinkRecordSelectionQuery } from './share-link-query.util';

// The client-supplied parts of a share read that can name fields.
type IShareSearch = NonNullable<IGetRecordsRo['search']>;

export interface IShareQueryFieldRefs {
  filter?: IFilter | null;
  groupBy?: IGroup | null;
  orderBy?: ISortItem[] | null;
  search?: IShareSearch;
}

// V1 searches every column when no field key is given, and its hidden-column check
// only knows the grid `hidden` flag. Pin an all-field search to the share-visible
// columns instead so kanban/gallery/calendar shares cannot probe `visible: false`
// columns through the search row filter. V2 scopes search by itself.
export const scopeSearchToVisibleFields = (
  search: IShareSearch | undefined,
  visibleFieldIds: string[] | undefined
): IShareSearch | undefined => {
  if (!search || search[1] || !visibleFieldIds) return search;
  if (!visibleFieldIds.length) return undefined;
  const fieldKeys = visibleFieldIds.join(',');
  return search[2] === undefined ? [search[0], fieldKeys] : [search[0], fieldKeys, search[2]];
};

const collectFilterItems = (filter: IFilter | null | undefined): IFilterItem[] => {
  if (!filter) return [];
  const items: IFilterItem[] = [];
  const traverse = (node: IFilter | IFilterItem) => {
    if (node && 'fieldId' in node) {
      items.push(node);
    } else if (node && 'filterSet' in node) {
      node.filterSet.forEach((child) => traverse(child));
    }
  };
  traverse(filter);
  return items;
};

const filterItemFieldIds = (item: IFilterItem): string[] => {
  const fieldIds = [item.fieldId];
  const { value } = item;
  if (isFieldReferenceValue(value)) {
    fieldIds.push(value.fieldId);
  } else if (Array.isArray(value)) {
    value.forEach((entry) => {
      if (isFieldReferenceValue(entry)) fieldIds.push(entry.fieldId);
    });
  }
  return fieldIds;
};

@Injectable()
export class ShareSocketService {
  constructor(
    private readonly viewService: ViewService,
    private readonly viewOpenApiV2Service: ViewOpenApiV2Service,
    private readonly fieldService: FieldService,
    private readonly recordService: RecordService,
    private readonly cls: ClsService<IClsStore>,
    private readonly recordOpenApiV2Service: RecordOpenApiV2Service,
    private readonly fieldOpenApiV2Service: FieldOpenApiV2Service
  ) {}

  async getViewDocIdsByQuery(shareInfo: IShareViewInfo) {
    const { tableId, view } = shareInfo;
    if (!view) {
      throw new CustomHttpException('View not found', HttpErrorCode.NOT_FOUND, {
        localization: {
          i18nKey: 'httpErrors.view.notFound',
        },
      });
    }
    if (this.cls.get('useV2')) {
      await this.viewOpenApiV2Service.getView(tableId, view.id);
      return { ids: [view.id] };
    }
    return this.viewService.getDocIdsByQuery(tableId, {
      includeIds: [view.id],
    });
  }

  async getViewSnapshotBulk(shareInfo: IShareViewInfo, ids: string[]) {
    const { tableId, view } = shareInfo;
    if (!view) {
      throw new CustomHttpException('View not found', HttpErrorCode.NOT_FOUND, {
        localization: {
          i18nKey: 'httpErrors.view.notFound',
        },
      });
    }

    if (ids.length > 1 || ids[0] !== view.id) {
      throw new CustomHttpException(
        'View permission not allowed: read',
        HttpErrorCode.RESTRICTED_RESOURCE,
        {
          localization: {
            i18nKey: 'httpErrors.shareSocket.viewPermissionNotAllowed',
          },
        }
      );
    }
    if (this.cls.get('useV2')) {
      return this.viewOpenApiV2Service.getSnapshotBulk(tableId, [view.id]);
    }
    return this.viewService.getSnapshotBulk(tableId, [view.id]);
  }

  // The fields a share visitor may read: the view's non-hidden fields (or, for a
  // link share, its configured visibleFieldIds plus the primary field).
  async getShareVisibleFields(
    shareInfo: IShareViewInfo,
    query: IGetFieldsQuery = {}
  ): Promise<IFieldVo[]> {
    const { tableId, view, linkOptions } = shareInfo;
    const { filterByViewId, visibleFieldIds } = linkOptions ?? {};
    const viewId = filterByViewId ?? view?.id;
    const filterHidden = Boolean(filterByViewId) || !view?.shareMeta?.includeHiddenField;
    const fields = this.cls.get('useV2')
      ? await this.fieldOpenApiV2Service.getFields(tableId, {
          ...query,
          viewId,
          filterHidden,
        })
      : await this.fieldService.getFieldsByQuery(tableId, {
          ...query,
          viewId,
          filterHidden,
        });

    return visibleFieldIds?.length
      ? fields.filter((field) => visibleFieldIds.includes(field.id) || field.isPrimary)
      : fields;
  }

  async getFieldDocIdsByQuery(shareInfo: IShareViewInfo, query: IGetFieldsQuery = {}) {
    const fields = await this.getShareVisibleFields(shareInfo, query);
    return { ids: fields.map((field) => field.id) };
  }

  /**
   * Reject client-supplied conditions that name a field the share does not expose
   * (GHSA-q8r5-c6qq-98fw, GHSA-c3j8-p5q3-pg2q). A filter, group, sort or search on a
   * hidden column never projects the column, but the resulting row counts, group
   * headers and orderings still reveal its values. Conditions the owner saved on the
   * shared view itself stay allowed: the share page inlines the view's own filter,
   * sort and group into the queries it sends.
   *
   * Returns the visible field ids, or undefined when the share exposes every field.
   */
  async assertQueryFieldsVisible(
    shareInfo: IShareViewInfo,
    query: IShareQueryFieldRefs | undefined
  ): Promise<string[] | undefined> {
    const { view, linkOptions, shareMeta } = shareInfo;
    if (shareMeta?.includeHiddenField && !linkOptions) {
      return undefined;
    }
    const visibleFields = await this.getShareVisibleFields(shareInfo);
    const visibleFieldIds = visibleFields.map((field) => field.id);
    if (!query) {
      return visibleFieldIds;
    }

    const visible = new Set(visibleFieldIds);
    const isVisible = (fieldId: string) => visible.has(fieldId);

    const ownFilterItems = collectFilterItems(view?.filter);
    collectFilterItems(query.filter).forEach((item) => {
      if (filterItemFieldIds(item).every(isVisible)) return;
      // the owner's own condition, echoed back by the share page
      if (ownFilterItems.some((own) => isEqual(own, item))) return;
      this.throwFieldHidden();
    });

    const ownGroupFieldIds = new Set((view?.group ?? []).map((item) => item.fieldId));
    (query.groupBy ?? []).forEach(({ fieldId }) => {
      if (!isVisible(fieldId) && !ownGroupFieldIds.has(fieldId)) this.throwFieldHidden();
    });

    const ownSortFieldIds = new Set((view?.sort?.sortObjs ?? []).map((item) => item.fieldId));
    (query.orderBy ?? []).forEach(({ fieldId }) => {
      if (!isVisible(fieldId) && !ownSortFieldIds.has(fieldId)) this.throwFieldHidden();
    });

    const searchFieldKeys = query.search?.[1];
    if (searchFieldKeys) {
      const visibleNames = new Set(visibleFields.map((field) => field.name));
      searchFieldKeys.split(',').forEach((key) => {
        if (!isVisible(key) && !visibleNames.has(key)) this.throwFieldHidden();
      });
    }

    return visibleFieldIds;
  }

  private throwFieldHidden(): never {
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

  async getFieldSnapshotBulk(shareInfo: IShareViewInfo, ids: string[]) {
    const { tableId } = shareInfo;
    await this.validFieldSnapshotPermission(shareInfo, ids);
    const { ids: fieldIds } = await this.getFieldDocIdsByQuery(shareInfo);
    if (this.cls.get('useV2')) {
      return this.fieldOpenApiV2Service.getSnapshotBulk(tableId, fieldIds);
    }
    return this.fieldService.getSnapshotBulk(tableId, fieldIds);
  }

  async validFieldSnapshotPermission(shareInfo: IShareViewInfo, ids: string[]) {
    const { ids: fieldIds } = await this.getFieldDocIdsByQuery(shareInfo);
    const unPermissionIds = difference(ids, fieldIds);
    if (unPermissionIds.length) {
      throw new CustomHttpException(
        `Field(${unPermissionIds.join(',')}) permission not allowed: read`,
        HttpErrorCode.RESTRICTED_RESOURCE,
        {
          localization: {
            i18nKey: 'httpErrors.shareSocket.fieldPermissionNotAllowed',
          },
        }
      );
    }
  }

  async getRecordDocIdsByQuery(
    shareInfo: IShareViewInfo,
    query: IShareViewRecordsRo,
    useQueryModel = true
  ) {
    const { tableId, view, linkOptions, shareMeta } = shareInfo;

    if (!shareMeta?.includeRecords) {
      return { ids: [] };
    }

    // viewId/ignoreViewQuery are not part of IShareViewRecordsRo, so the view
    // scope set below cannot be dropped by the caller.
    const visibleFieldIds = await this.assertQueryFieldsVisible(shareInfo, query);

    const { id } = view ?? {};
    const { filterByViewId } = linkOptions ?? {};
    // Queries that load already-linked records (filterLinkCellSelected or explicit
    // selectedRecordIds) must return them in full, even when they fall outside the link
    // field's view scope. The view scope/filter only constrains the candidate list. T4864.
    const isLinkSelectionQuery = Boolean(linkOptions) && isLinkRecordSelectionQuery(query);
    const viewId = isLinkSelectionQuery ? id : filterByViewId ?? id;
    const filter = isLinkSelectionQuery ? undefined : linkOptions?.filter ?? query.filter;
    let projection = query.projection;

    if (linkOptions) {
      projection = (await this.getFieldDocIdsByQuery(shareInfo, query)).ids;
    }

    if (this.cls.get('useV2')) {
      return this.recordOpenApiV2Service.getSocketDocIds(tableId, {
        ...query,
        viewId,
        filter,
        projection,
      });
    }

    return this.recordService.getDocIdsByQuery(
      tableId,
      {
        ...query,
        viewId,
        filter,
        projection,
        search: scopeSearchToVisibleFields(query.search, visibleFieldIds),
      },
      useQueryModel
    );
  }

  async getRecordSnapshotBulk(
    shareInfo: IShareViewInfo,
    ids: string[],
    useQueryModel: boolean,
    projection?: { [fieldNameOrId: string]: boolean }
  ) {
    const { tableId } = shareInfo;
    await this.validRecordSnapshotPermission(shareInfo, ids);
    const { ids: allowedFieldIds } = await this.getFieldDocIdsByQuery(shareInfo);
    // An empty projection means "every field" downstream; a share that exposes no
    // field at all must not fall through to that.
    if (!allowedFieldIds.length) {
      return [];
    }
    const allowedFieldIdSet = new Set(allowedFieldIds);
    const requestedFieldIds = projection
      ? Object.entries(projection)
          .filter(([, included]) => included)
          .map(([fieldId]) => fieldId)
      : [];
    // Requesting only fields outside the share must not filter down to an empty
    // projection, which also reads as "every field"; fall back to the share's fields.
    const requestedVisibleFieldIds = requestedFieldIds.filter((fieldId) =>
      allowedFieldIdSet.has(fieldId)
    );
    const projectedFieldIds = requestedVisibleFieldIds.length
      ? requestedVisibleFieldIds
      : allowedFieldIds;
    const safeProjection = Object.fromEntries(projectedFieldIds.map((fieldId) => [fieldId, true]));
    if (this.cls.get('useV2')) {
      return this.recordOpenApiV2Service.getSocketSnapshotBulk(tableId, ids, safeProjection);
    }
    return this.recordService.getSnapshotBulk(
      tableId,
      ids,
      safeProjection,
      undefined,
      undefined,
      useQueryModel
    );
  }

  async validRecordSnapshotPermission(shareInfo: IShareViewInfo, ids: string[]) {
    const { tableId, shareMeta, view } = shareInfo;
    if (!shareMeta?.includeRecords) {
      throw new CustomHttpException(
        `Record(${ids.join(',')}) permission not allowed: read`,
        HttpErrorCode.RESTRICTED_RESOURCE,
        {
          localization: {
            i18nKey: 'httpErrors.shareSocket.recordPermissionNotAllowed',
          },
        }
      );
    }
    const diff = await this.recordService.getDiffIdsByIdAndFilter(tableId, ids, view?.filter);
    if (diff.length) {
      throw new CustomHttpException(
        `Record(${diff.join(',')}) permission not allowed: read`,
        HttpErrorCode.RESTRICTED_RESOURCE,
        {
          localization: {
            i18nKey: 'httpErrors.shareSocket.recordPermissionNotAllowed',
          },
        }
      );
    }
  }
}
