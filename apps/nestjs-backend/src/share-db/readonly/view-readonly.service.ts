import { Injectable } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import { IS_TEMPLATE_HEADER, BASE_SHARE_ID_HEADER } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import type { IShareDbReadonlyAdapterService, RawOpType } from '../interface';
import { ReadonlyService } from './readonly.service';
import type { IReadonlyServiceContext } from './types';

@Injectable()
export class ViewReadonlyServiceAdapter
  extends ReadonlyService
  implements IShareDbReadonlyAdapterService
{
  constructor(
    private readonly cls: ClsService<IReadonlyServiceContext>,
    private readonly prismaService: PrismaService
  ) {
    super(cls);
  }

  getDocIdsByQuery(tableId: string) {
    const shareId = this.cls.get('shareViewId');
    const baseShareId = this.cls.get('baseShareId');
    const useShareViewEndpoint = shareId && !baseShareId;
    const templateHeader = this.cls.get('templateHeader');
    const url = useShareViewEndpoint
      ? `/share/${shareId}/socket/view/doc-ids`
      : `/table/${tableId}/view/socket/doc-ids`;
    return this.axios
      .get(url, {
        headers: {
          cookie: this.cls.get('cookie'),
          [IS_TEMPLATE_HEADER]: templateHeader,
          [BASE_SHARE_ID_HEADER]: baseShareId,
        },
      })
      .then((res) => res.data);
  }
  getSnapshotBulk(tableId: string, ids: string[]) {
    const shareId = this.cls.get('shareViewId');
    const baseShareId = this.cls.get('baseShareId');
    const useShareViewEndpoint = shareId && !baseShareId;
    const templateHeader = this.cls.get('templateHeader');
    const url = useShareViewEndpoint
      ? `/share/${shareId}/socket/view/snapshot-bulk`
      : `/table/${tableId}/view/socket/snapshot-bulk`;
    return this.axios
      .get(url, {
        headers: {
          cookie: this.cls.get('cookie'),
          [IS_TEMPLATE_HEADER]: templateHeader,
          [BASE_SHARE_ID_HEADER]: baseShareId,
        },
        params: {
          ids,
        },
      })
      .then((res) => res.data);
  }

  getVersionAndType(tableId: string, viewId: string) {
    return this.prismaService.view
      .findUnique({
        where: {
          id: viewId,
          tableId,
        },
        select: {
          version: true,
          deletedTime: true,
        },
      })
      .then((res) => {
        return this.formatVersionAndType(res);
      });
  }

  getVersionAndTypeMap(tableId: string, viewIds: string[]) {
    return this.prismaService.view
      .findMany({
        where: {
          id: { in: viewIds },
          tableId,
        },
        select: {
          id: true,
          version: true,
          deletedTime: true,
        },
      })
      .then((views) => {
        return views.reduce(
          (acc, view) => {
            acc[view.id] = this.formatVersionAndType(view);
            return acc;
          },
          {} as Record<string, { version: number; type: RawOpType }>
        );
      });
  }
}
