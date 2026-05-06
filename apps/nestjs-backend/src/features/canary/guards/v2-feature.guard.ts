import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IdPrefix } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { V2Feature } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../../types/cls';
import { CanaryService, type IBaseV2DecisionContext } from '../canary.service';
import { USE_V2_FEATURE_KEY } from '../decorators/use-v2-feature.decorator';

/**
 * Guard that determines if V2 implementation should be used.
 * Works with @UseV2Feature decorator to enable V2 based on canary configuration.
 *
 * The guard:
 * 1. Reads the feature name from @UseV2Feature decorator
 * 2. Extracts spaceId from request (via tableId -> baseId -> spaceId)
 * 3. Calls CanaryService.shouldUseV2() to determine if V2 should be used
 * 4. Stores the result in CLS for the controller to use
 *
 * @example
 * ```typescript
 * @UseGuards(V2FeatureGuard)
 * @Controller('api/table/:tableId/record')
 * export class RecordController {
 *   @UseV2Feature('createRecord')
 *   @Post()
 *   async createRecords(...) {
 *     if (this.cls.get('useV2')) {
 *       return this.v2Service.createRecords(...);
 *     }
 *     return this.v1Service.createRecords(...);
 *   }
 * }
 * ```
 */
@Injectable()
export class V2FeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly cls: ClsService<IClsStore>,
    private readonly canaryService: CanaryService,
    private readonly prismaService: PrismaService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();

    // Store windowId from header for undo/redo tracking
    const windowId = req.headers['x-window-id'] as string | undefined;
    if (windowId) {
      this.cls.set('windowId', windowId);
    }

    // 1. Get the feature name from decorator
    const feature = this.reflector.getAllAndOverride<V2Feature | undefined>(USE_V2_FEATURE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No feature marked, default to V1
    if (!feature) {
      this.cls.set('useV2', false);
      this.cls.set('v2Reason', 'no_feature');
      return true;
    }

    if (this.isUnsupportedV2Payload(req.body, feature)) {
      this.cls.set('useV2', false);
      this.cls.set('v2Feature', feature);
      this.cls.set('v2Reason', 'unsupported_feature');
      return true;
    }

    // 2. Resolve base context when possible. Marked new bases are V2-first and bypass rollout config.
    const base = await this.getBaseV2DecisionContext(context);
    const decision = await this.canaryService.shouldUseV2ForBaseWithReason(base, feature);
    this.cls.set('useV2', decision.useV2);
    this.cls.set('v2Feature', feature);
    this.cls.set('v2Reason', decision.reason);

    return true;
  }

  private isUnsupportedV2Payload(body: unknown, feature: V2Feature): boolean {
    if (feature !== 'updateRecord') {
      return false;
    }

    const updateRecordBody = body as
      | {
          record?: { fields?: Record<string, unknown> | null } | null;
          order?: unknown;
        }
      | undefined;
    const fields = updateRecordBody?.record?.fields ?? {};

    // V2 does not yet support updateRecord calls that only reorder a record.
    return Boolean(updateRecordBody?.order) && Object.keys(fields).length === 0;
  }

  /**
   * Extract base V2 decision context from request context.
   * Supports: spaceId (direct), baseId (lookup), tableId (lookup via base)
   */
  private async getBaseV2DecisionContext(
    context: ExecutionContext
  ): Promise<IBaseV2DecisionContext | undefined> {
    const req = context.switchToHttp().getRequest();
    const resourceId =
      req.params.spaceId ||
      req.params.baseId ||
      req.params.tableId ||
      this.getStringResourceId(req.body, ['spaceId', 'baseId', 'tableId']);

    if (!resourceId) {
      return undefined;
    }

    // Direct spaceId
    if (resourceId.startsWith(IdPrefix.Space)) {
      return { spaceId: resourceId };
    }

    // BaseId -> lookup spaceId
    if (resourceId.startsWith(IdPrefix.Base)) {
      const base = await this.prismaService.txClient().base.findUnique({
        where: { id: resourceId, deletedTime: null },
        select: { spaceId: true, v2Enabled: true },
      });
      return base ?? undefined;
    }

    // TableId -> lookup baseId -> lookup spaceId
    if (resourceId.startsWith(IdPrefix.Table)) {
      const table = await this.prismaService.txClient().tableMeta.findUnique({
        where: { id: resourceId, deletedTime: null },
        select: { baseId: true },
      });

      if (!table) return undefined;

      const base = await this.prismaService.txClient().base.findUnique({
        where: { id: table.baseId, deletedTime: null },
        select: { spaceId: true, v2Enabled: true },
      });
      return base ?? undefined;
    }

    return undefined;
  }

  private getStringResourceId(source: unknown, keys: string[]): string | undefined {
    if (!source || typeof source !== 'object') {
      return undefined;
    }

    const record = source as Record<string, unknown>;
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string') {
        return value;
      }
    }

    return undefined;
  }
}
