import { Injectable } from '@nestjs/common';
import { HttpErrorCode } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { CustomHttpException } from '../../custom.exception';

export interface IBaseResolveOptions {
  /** Also resolve trashed bases. Off by default. */
  includeDeleted?: boolean;
  /** Raise a 404 when the base is gone. On by default. */
  shouldThrow?: boolean;
}

const deletedTimeFilter = ({ includeDeleted }: IBaseResolveOptions) =>
  includeDeleted ? {} : { deletedTime: null };

/**
 * Cross-request base→space resolution for admission control.
 *
 * Bases CAN move between spaces (`PUT /base/{id}/move`), so job payloads carry
 * the immutable `baseId` and admission attributes to whatever space the base
 * belongs to AT ACQUIRE TIME. Deliberately uncached: every resolution is one
 * PK lookup, and a moved base is attributed to its new space immediately.
 */
@Injectable()
export class BaseModel {
  constructor(private readonly prismaService: PrismaService) {}

  // the `shouldThrow: false` signature must come first: that call also satisfies
  // the plain-options one, and TS picks the first match
  async getSpaceIdByBaseId(
    baseId: string,
    options: IBaseResolveOptions & { shouldThrow: false }
  ): Promise<string | undefined>;
  async getSpaceIdByBaseId(baseId: string, options?: IBaseResolveOptions): Promise<string>;
  async getSpaceIdByBaseId(baseId: string, options: IBaseResolveOptions = {}) {
    const { shouldThrow = true } = options;
    const base = await this.prismaService.base.findUnique({
      where: { id: baseId, ...deletedTimeFilter(options) },
      select: { spaceId: true },
    });
    if (!base && shouldThrow) {
      throw new CustomHttpException('Base not found', HttpErrorCode.NOT_FOUND, {
        localization: { i18nKey: 'httpErrors.base.notFound' },
      });
    }
    return base?.spaceId;
  }

  /** Batch variant — one query; unresolved bases are simply absent from the map */
  async getSpaceIdsByBaseIds(
    baseIds: string[],
    options: IBaseResolveOptions = {}
  ): Promise<Map<string, string>> {
    if (!baseIds.length) return new Map();
    const bases = await this.prismaService.base.findMany({
      where: { id: { in: baseIds }, ...deletedTimeFilter(options) },
      select: { id: true, spaceId: true },
    });
    return new Map(bases.map((base) => [base.id, base.spaceId]));
  }
}
