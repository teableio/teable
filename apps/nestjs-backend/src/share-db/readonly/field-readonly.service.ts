import { ForbiddenException, Injectable } from '@nestjs/common';
import type { IGetFieldsQuery } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { IS_TEMPLATE_HEADER, BASE_SHARE_ID_HEADER } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import type { RawOpType, IShareDbReadonlyAdapterService } from '../interface';
import { ReadonlyService } from './readonly.service';
import type { IReadonlyServiceContext } from './types';

@Injectable()
export class FieldReadonlyServiceAdapter
  extends ReadonlyService
  implements IShareDbReadonlyAdapterService
{
  constructor(
    private readonly cls: ClsService<IReadonlyServiceContext>,
    private readonly prismaService: PrismaService
  ) {
    super(cls);
  }

  getDocIdsByQuery(tableId: string, query: IGetFieldsQuery = {}) {
    const shareId = this.cls.get('shareViewId');
    const baseShareId = this.cls.get('baseShareId');
    const useShareViewEndpoint = shareId && !baseShareId;
    const templateHeader = this.cls.get('templateHeader');
    const url = useShareViewEndpoint
      ? `/share/${shareId}/socket/field/doc-ids`
      : `/table/${tableId}/field/socket/doc-ids`;
    return this.axios
      .get(url, {
        headers: {
          cookie: this.cls.get('cookie'),
          [IS_TEMPLATE_HEADER]: templateHeader,
          [BASE_SHARE_ID_HEADER]: baseShareId,
        },
        params: query,
      })
      .then((res) => res.data);
  }
  getSnapshotBulk(tableId: string, ids: string[]) {
    const shareId = this.cls.get('shareViewId');
    const baseShareId = this.cls.get('baseShareId');
    const useShareViewEndpoint = shareId && !baseShareId;
    const templateHeader = this.cls.get('templateHeader');
    const url = useShareViewEndpoint
      ? `/share/${shareId}/socket/field/snapshot-bulk`
      : `/table/${tableId}/field/socket/snapshot-bulk`;
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
  authorizeComputedActivityRead(tableId: string): Promise<void> {
    const shareId = this.cls.get('shareViewId');
    const baseShareId = this.cls.get('baseShareId');
    if (!shareId || baseShareId) {
      return this.getDocIdsByQuery(tableId).then(() => undefined);
    }

    return this.axios
      .get(`/share/${shareId}/socket/computed-activity/authorize`, {
        headers: { cookie: this.cls.get('cookie') },
        params: { tableId },
      })
      .then(() => undefined);
  }

  async authorizeComputedActivityDocuments(tableId: string, ids: string[]): Promise<void> {
    // A global table document cannot be safely projected for individual subscribers.
    if (ids.includes('table'))
      throw new ForbiddenException('Computed activity aggregate is private');
    if (!ids.length) return;
    const shareId = this.cls.get('shareViewId');
    if (shareId && !this.cls.get('baseShareId')) {
      await this.authorizeComputedActivityRead(tableId);
    }
    const snapshots = await this.getSnapshotBulk(tableId, ids);
    const readable = new Set(
      snapshots
        .filter(
          (snapshot: {
            id: string;
            data?: { recordRead?: boolean; computedActivityRead?: boolean };
          }) =>
            snapshot.data &&
            snapshot.data.recordRead !== false &&
            snapshot.data.computedActivityRead !== false
        )
        .map((snapshot: { id: string }) => snapshot.id)
    );
    if (ids.some((id) => !readable.has(id))) {
      throw new ForbiddenException('Computed activity permission not allowed');
    }
  }

  getVersionAndType(tableId: string, fieldId: string) {
    return this.prismaService.field
      .findUnique({
        where: {
          id: fieldId,
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

  getVersionAndTypeMap(tableId: string, fieldIds: string[]) {
    return this.prismaService.field
      .findMany({
        where: {
          id: { in: fieldIds },
          tableId,
        },
        select: {
          id: true,
          version: true,
          deletedTime: true,
        },
      })
      .then((fields) => {
        return fields.reduce(
          (acc, field) => {
            acc[field.id] = this.formatVersionAndType(field);
            return acc;
          },
          {} as Record<string, { version: number; type: RawOpType }>
        );
      });
  }
}
