import { Injectable } from '@nestjs/common';
import type { IGetRecordsRo } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import type { IReadonlyAdapterService } from '../interface';
import { ReadonlyService } from './readonly.service';

@Injectable()
export class RecordReadonlyServiceAdapter
  extends ReadonlyService
  implements IReadonlyAdapterService
{
  constructor(private readonly cls: ClsService<IClsStore>) {
    super(cls);
  }

  getDocIdsByQuery(tableId: string, query: IGetRecordsRo = {}) {
    const shareId = this.cls.get('shareViewId');
    const url = shareId
      ? `/share/${shareId}/socket/record/doc-ids`
      : `/table/${tableId}/record/socket/doc-ids`;
    return this.axios
      .post(
        url,
        {
          ...query,
          filter: JSON.stringify(query?.filter),
          orderBy: JSON.stringify(query?.orderBy),
          groupBy: JSON.stringify(query?.groupBy),
          collapsedGroupIds: JSON.stringify(query?.collapsedGroupIds),
        },
        {
          headers: {
            cookie: this.cls.get('cookie'),
          },
        }
      )
      .then((res) => res.data);
  }
  getSnapshotBulk(
    tableId: string,
    recordIds: string[],
    projection?: { [fieldNameOrId: string]: boolean }
  ) {
    const shareId = this.cls.get('shareViewId');
    const url = shareId
      ? `/share/${shareId}/socket/record/snapshot-bulk`
      : `/table/${tableId}/record/socket/snapshot-bulk`;
    return this.axios
      .get(url, {
        headers: {
          cookie: this.cls.get('cookie'),
        },
        params: {
          ids: recordIds,
          projection,
        },
      })
      .then((res) => res.data);
  }
}
