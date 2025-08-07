import { Injectable } from '@nestjs/common';
import type { IGetFieldsQuery } from '@teable/core';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import type { IReadonlyAdapterService } from '../interface';
import { ReadonlyService } from './readonly.service';

@Injectable()
export class FieldReadonlyServiceAdapter
  extends ReadonlyService
  implements IReadonlyAdapterService
{
  constructor(private readonly cls: ClsService<IClsStore>) {
    super(cls);
  }

  getDocIdsByQuery(tableId: string, query: IGetFieldsQuery = {}) {
    const shareId = this.cls.get('shareViewId');
    const url = shareId
      ? `/share/${shareId}/socket/field/doc-ids`
      : `/table/${tableId}/field/socket/doc-ids`;
    return this.axios
      .get(url, {
        headers: {
          cookie: this.cls.get('cookie'),
        },
        params: query,
      })
      .then((res) => res.data);
  }
  getSnapshotBulk(tableId: string, ids: string[]) {
    const shareId = this.cls.get('shareViewId');
    const url = shareId
      ? `/share/${shareId}/socket/field/snapshot-bulk`
      : `/table/${tableId}/field/socket/snapshot-bulk`;
    return this.axios
      .get(url, {
        headers: {
          cookie: this.cls.get('cookie'),
        },
        params: {
          ids,
        },
      })
      .then((res) => res.data);
  }
}
