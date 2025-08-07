import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import type { IReadonlyAdapterService } from '../interface';
import { ReadonlyService } from './readonly.service';

@Injectable()
export class ViewReadonlyServiceAdapter extends ReadonlyService implements IReadonlyAdapterService {
  constructor(private readonly cls: ClsService<IClsStore>) {
    super(cls);
  }

  getDocIdsByQuery(tableId: string) {
    const shareId = this.cls.get('shareViewId');
    const url = shareId
      ? `/share/${shareId}/socket/view/doc-ids`
      : `/table/${tableId}/view/socket/doc-ids`;
    return this.axios
      .get(url, {
        headers: {
          cookie: this.cls.get('cookie'),
        },
      })
      .then((res) => res.data);
  }
  getSnapshotBulk(tableId: string, ids: string[]) {
    const shareId = this.cls.get('shareViewId');
    const url = shareId
      ? `/share/${shareId}/socket/view/snapshot-bulk`
      : `/table/${tableId}/view/socket/snapshot-bulk`;
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
