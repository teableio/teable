import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { HttpErrorCode } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { CustomHttpException } from '../../../custom.exception';

/**
 * Asserts the route `:tableId` belongs to the path `:baseId`: without it, any
 * base owner could reach a foreign tenant's table by pairing their baseId with
 * its global id. No-op when either param is absent.
 */
@Injectable()
export class TableBaseScopeGuard implements CanActivate {
  constructor(private readonly prismaService: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { baseId, tableId } = context.switchToHttp().getRequest().params ?? {};
    if (!baseId || !tableId) {
      return true;
    }
    const table = await this.prismaService.tableMeta.findUnique({
      where: { id: tableId },
      select: { baseId: true },
    });
    if (table?.baseId !== baseId) {
      throw new CustomHttpException(
        `Table ${tableId} not found in base ${baseId}`,
        HttpErrorCode.NOT_FOUND,
        {
          localization: {
            i18nKey: 'httpErrors.notFound',
          },
        }
      );
    }
    return true;
  }
}
