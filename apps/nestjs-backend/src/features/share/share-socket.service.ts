import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { HttpErrorCode, type IGetFieldsQuery } from '@teable/core';
import type { IGetRecordsRo } from '@teable/openapi';
import { Knex } from 'knex';
import { difference } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { CustomHttpException } from '../../custom.exception';
import { FieldService } from '../field/field.service';
import { RecordService } from '../record/record.service';
import { ViewService } from '../view/view.service';
import type { IShareViewInfo } from './share-auth.service';

@Injectable()
export class ShareSocketService {
  constructor(
    private readonly viewService: ViewService,
    private readonly fieldService: FieldService,
    private readonly recordService: RecordService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex
  ) {}

  getViewDocIdsByQuery(shareInfo: IShareViewInfo) {
    const { tableId, view } = shareInfo;
    if (!view) {
      throw new CustomHttpException('View not found', HttpErrorCode.NOT_FOUND, {
        localization: {
          i18nKey: 'httpErrors.view.notFound',
        },
      });
    }
    return this.viewService.getDocIdsByQuery(tableId, {
      includeIds: [view.id],
    });
  }

  getViewSnapshotBulk(shareInfo: IShareViewInfo, ids: string[]) {
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
    return this.viewService.getSnapshotBulk(tableId, [view.id]);
  }

  async getFieldDocIdsByQuery(shareInfo: IShareViewInfo, query: IGetFieldsQuery = {}) {
    const { tableId, view, linkOptions } = shareInfo;
    const { filterByViewId, visibleFieldIds } = linkOptions ?? {};
    const viewId = filterByViewId ?? view?.id;
    const filterHidden = !view?.shareMeta?.includeHiddenField;

    const fields = await this.fieldService.getFieldsByQuery(tableId, {
      ...query,
      viewId,
      filterHidden: Boolean(filterByViewId) || filterHidden,
    });
    const fieldIds = fields.map((field) => field.id);

    if (visibleFieldIds?.length) {
      return {
        ids: fields
          .filter((f) => visibleFieldIds?.includes(f.id) || f.isPrimary)
          .map((field) => field.id),
      };
    }
    return { ids: fieldIds };
  }

  async getFieldSnapshotBulk(shareInfo: IShareViewInfo, ids: string[]) {
    const { tableId } = shareInfo;
    await this.validFieldSnapshotPermission(shareInfo, ids);
    const { ids: fieldIds } = await this.getFieldDocIdsByQuery(shareInfo);
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
    const viewId = filterByViewId ?? id;
    // if filterLinkCellSelected is not empty, use it as filter
    const defaultFilter = linkOptions?.filter ?? query.filter;
    const filter = !query.filterLinkCellSelected ? defaultFilter : undefined;
    let projection = query.projection;

    if (linkOptions) {
      projection = (await this.getFieldDocIdsByQuery(shareInfo, query)).ids;
    }

    return this.recordService.getDocIdsByQuery(
      tableId,
      { ...query, viewId, filter, projection },
      useQueryModel
    );
  }

  async getRecordSnapshotBulk(shareInfo: IShareViewInfo, ids: string[], useQueryModel: boolean) {
    const { tableId } = shareInfo;
    await this.validRecordSnapshotPermission(shareInfo, ids);
    return this.recordService.getSnapshotBulk(
      tableId,
      ids,
      undefined,
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
