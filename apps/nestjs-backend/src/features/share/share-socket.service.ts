import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import type { IGetFieldsQuery } from '@teable/core';
import type { IGetRecordsRo } from '@teable/openapi';
import { Knex } from 'knex';
import { difference } from 'lodash';
import { InjectModel } from 'nest-knexjs';
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
      throw new BadRequestException('view id is required');
    }
    return this.viewService.getDocIdsByQuery(tableId, {
      includeIds: [view.id],
    });
  }

  getViewSnapshotBulk(shareInfo: IShareViewInfo, ids: string[]) {
    const { tableId, view } = shareInfo;
    if (!view) {
      throw new BadRequestException('view id is required');
    }

    if (ids.length > 1 || ids[0] !== view.id) {
      throw new ForbiddenException('View permission not allowed: read');
    }
    return this.viewService.getSnapshotBulk(tableId, [view.id]);
  }

  async getFieldDocIdsByQuery(shareInfo: IShareViewInfo, query: IGetFieldsQuery = {}) {
    const { tableId, view, linkOptions } = shareInfo;
    const { filterByViewId, hiddenFieldIds } = linkOptions ?? {};
    const viewId = filterByViewId ?? view?.id;
    const filterHidden = !view?.shareMeta?.includeHiddenField;

    const { ids: fieldIds } = await this.fieldService.getDocIdsByQuery(tableId, {
      ...query,
      viewId,
      filterHidden: Boolean(filterByViewId) || filterHidden,
    });

    if (hiddenFieldIds?.length) {
      return {
        ids: fieldIds.filter((id) => !hiddenFieldIds?.includes(id)),
      };
    }
    return { ids: fieldIds };
  }

  async getFieldSnapshotBulk(shareInfo: IShareViewInfo, ids: string[]) {
    const { tableId } = shareInfo;
    const { ids: fieldIds } = await this.getFieldDocIdsByQuery(shareInfo);
    const unPermissionIds = difference(ids, fieldIds);
    if (unPermissionIds.length) {
      throw new ForbiddenException(
        `Field(${unPermissionIds.join(',')}) permission not allowed: read`
      );
    }
    return this.fieldService.getSnapshotBulk(tableId, fieldIds);
  }

  async getRecordDocIdsByQuery(shareInfo: IShareViewInfo, query: IGetRecordsRo) {
    const { tableId, view, linkOptions } = shareInfo;
    const { id } = view ?? {};
    const { filterByViewId, hiddenFieldIds } = linkOptions ?? {};
    const viewId = filterByViewId ?? id;
    const filter = linkOptions?.filter ?? query.filter;
    let projection = query.projection;

    if (filterByViewId || hiddenFieldIds?.length) {
      projection = (await this.getFieldDocIdsByQuery(shareInfo, query)).ids;
    }

    return this.recordService.getDocIdsByQuery(tableId, { ...query, viewId, filter, projection });
  }

  async getRecordSnapshotBulk(shareInfo: IShareViewInfo, ids: string[]) {
    const { tableId, view } = shareInfo;
    const diff = await this.recordService.getDiffIdsByIdAndFilter(tableId, ids, view?.filter);
    if (diff.length) {
      throw new ForbiddenException(`Record(${diff.join(',')}) permission not allowed: read`);
    }
    return this.recordService.getSnapshotBulk(tableId, ids);
  }
}
