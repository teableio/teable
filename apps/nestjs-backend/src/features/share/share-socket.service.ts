import { Injectable } from '@nestjs/common';
import { HttpErrorCode, type IGetFieldsQuery } from '@teable/core';
import type { IGetRecordsRo } from '@teable/openapi';
import { difference } from 'lodash';
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

  async getFieldDocIdsByQuery(shareInfo: IShareViewInfo, query: IGetFieldsQuery = {}) {
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

    if (visibleFieldIds?.length) {
      return {
        ids: fields
          .filter((field) => visibleFieldIds.includes(field.id) || field.isPrimary)
          .map((field) => field.id),
      };
    }
    return { ids: fields.map((field) => field.id) };
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
    query: IGetRecordsRo,
    useQueryModel = true
  ) {
    const { tableId, view, linkOptions, shareMeta } = shareInfo;

    if (!shareMeta?.includeRecords) {
      return { ids: [] };
    }

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
      { ...query, viewId, filter, projection },
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
    const allowedFieldIdSet = new Set(allowedFieldIds);
    const requestedFieldIds = projection
      ? Object.entries(projection)
          .filter(([, included]) => included)
          .map(([fieldId]) => fieldId)
      : [];
    const projectedFieldIds = requestedFieldIds.length
      ? requestedFieldIds.filter((fieldId) => allowedFieldIdSet.has(fieldId))
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
