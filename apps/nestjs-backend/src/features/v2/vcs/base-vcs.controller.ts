import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  type HttpErrorStatus,
  type IApiErrorResponseDto,
  type IVcsCheckoutInput,
  type IVcsDiffInput,
  type IVcsHistoryDiffOutput,
  type IVcsRollbackInput,
  type IVcsRollbackOutput,
  vcsCheckoutInputSchema,
  vcsDiffInputSchema,
  vcsRollbackInputSchema,
} from '@teable/v2-contract-http';
import {
  executeCloneVcsRecordsEndpoint,
  executeCloneVcsSnapshotEndpoint,
  executeEnableBaseVcsEndpoint,
  executeGetVcsHeadEndpoint,
  executeListVcsChangesEndpoint,
  executePushVcsPatchEndpoint,
  toVcsEndpointResult,
} from '@teable/v2-contract-http-implementation/handlers';
import {
  VCS_WRITE_BUSY_CODE,
  type IBaseVcsSnapshot,
  type IVcsCloneRecordsChunk,
  type IVcsHeadInfo,
  type IVcsIncrementalChanges,
  type IVcsPushResult,
} from '@teable/v2-vcs';
import {
  type BaseVcsHistoryService,
  type CloneVcsSnapshotService,
  type EnableBaseVcsService,
  type GetVcsHeadService,
  type ListVcsChangesService,
  type ListVcsTableRecordsChunkService,
  type PushVcsPatchService,
  v2VcsServerTokens,
} from '@teable/v2-vcs/server';
import { VcsEndpointHttpException } from '../../../custom.exception';
import { ZodValidationPipe } from '../../../zod.validation.pipe';
import { AnyPermissions, Permissions } from '../../auth/decorators/permissions.decorator';
import { ResourceMeta } from '../../auth/decorators/resource_meta.decorator';
import { TokenAccess } from '../../auth/decorators/token.decorator';
import { V2ContainerService } from '../v2-container.service';
import { V2ExecutionContextFactory } from '../v2-execution-context.factory';

const parseOptionalNonNegInt = (raw?: string): number | undefined => {
  if (raw === undefined || raw === '') return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0)
    throw new BadRequestException('Invalid "since" revision query parameter');
  return parsed;
};

const parseOptionalPosInt = (
  raw: string | undefined,
  label: string,
  max: number
): number | undefined => {
  if (raw === undefined || raw === '') return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max)
    throw new BadRequestException(`Invalid "${label}" query parameter`);
  return parsed;
};

const parseOptionalBooleanFlag = (raw?: string): boolean | undefined => {
  if (raw === undefined || raw === '') return undefined;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  throw new BadRequestException('Invalid "includeRecords" query parameter');
};

const CanWriteVcs = () =>
  AnyPermissions(
    ['table|create'],
    ['table|update'],
    ['table|delete'],
    ['field|create'],
    ['field|update'],
    ['field|delete'],
    ['view|create'],
    ['view|update'],
    ['view|delete'],
    ['record|create'],
    ['record|update'],
    ['record|delete']
  );

@Controller('api/v2/bases/:baseId/vcs')
export class BaseVcsController {
  constructor(
    private readonly v2ContainerService: V2ContainerService,
    private readonly v2ContextFactory: V2ExecutionContextFactory
  ) {}

  private async runWithVcsService<T>(
    baseId: string,
    exec: (
      container: Awaited<ReturnType<V2ContainerService['getContainerForBase']>>,
      ctx: Awaited<ReturnType<V2ExecutionContextFactory['createContext']>>
    ) => Promise<
      { status: 200; body: NoInfer<T> } | { status: HttpErrorStatus; body: IApiErrorResponseDto }
    >
  ): Promise<T> {
    const container = await this.v2ContainerService.getContainerForBase(baseId);
    const context = await this.v2ContextFactory.createContext(container);
    const res = await exec(container, context);
    if (res.status !== 200) {
      if (res.status >= 500 && res.body.error.code !== VCS_WRITE_BUSY_CODE) {
        throw new HttpException(res.body, res.status);
      }
      throw new VcsEndpointHttpException(res.body, res.status);
    }
    return res.body;
  }

  @Post('enable')
  @TokenAccess()
  @Permissions('base|update')
  @ResourceMeta('baseId', 'params')
  enable(@Param('baseId') baseId: string): Promise<{
    baseId: string;
    enabled: boolean;
    headRevision: number;
    enabledAtRevision: number;
  }> {
    return this.runWithVcsService(baseId, (c, ctx) =>
      executeEnableBaseVcsEndpoint(
        ctx,
        { baseId },
        c.resolve<EnableBaseVcsService>(v2VcsServerTokens.enableBaseVcsService)
      )
    );
  }

  @Get('head')
  @TokenAccess()
  @Permissions('base|read')
  @ResourceMeta('baseId', 'params')
  getHead(@Param('baseId') baseId: string): Promise<IVcsHeadInfo> {
    return this.runWithVcsService(baseId, (c, ctx) =>
      executeGetVcsHeadEndpoint(
        ctx,
        { baseId },
        c.resolve<GetVcsHeadService>(v2VcsServerTokens.getVcsHeadService)
      )
    );
  }

  @Get('clone')
  @TokenAccess()
  @Permissions('base|read')
  @ResourceMeta('baseId', 'params')
  clone(
    @Param('baseId') baseId: string,
    @Query('tables') tables?: string | string[],
    @Query('tableIds') tableIds?: string | string[],
    @Query('includeRecords') includeRecordsRaw?: string
  ): Promise<{ snapshot: IBaseVcsSnapshot; remoteMode: IVcsHeadInfo['remoteMode'] }> {
    const includeRecords = parseOptionalBooleanFlag(includeRecordsRaw);
    return this.runWithVcsService(baseId, (c, ctx) =>
      executeCloneVcsSnapshotEndpoint(
        ctx,
        {
          baseId,
          tables,
          tableIds,
          ...(includeRecords !== undefined ? { includeRecords } : {}),
        },
        c.resolve<CloneVcsSnapshotService>(v2VcsServerTokens.cloneVcsSnapshotService)
      )
    );
  }

  @Get('clone/records')
  @TokenAccess()
  @Permissions('base|read')
  @ResourceMeta('baseId', 'params')
  cloneRecords(
    @Param('baseId') baseId: string,
    @Query('tableId') tableId?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limitRaw?: string
  ): Promise<IVcsCloneRecordsChunk> {
    const cleanTableId = tableId?.trim();
    if (!cleanTableId) {
      throw new BadRequestException('Missing required "tableId" query parameter');
    }
    const limit = parseOptionalPosInt(limitRaw, 'limit', 2_000);
    return this.runWithVcsService(baseId, (c, ctx) =>
      executeCloneVcsRecordsEndpoint(
        ctx,
        {
          baseId,
          tableId: cleanTableId,
          ...(cursor?.trim() ? { cursor: cursor.trim() } : {}),
          ...(limit !== undefined ? { limit } : {}),
        },
        c.resolve<ListVcsTableRecordsChunkService>(
          v2VcsServerTokens.listVcsTableRecordsChunkService
        )
      )
    );
  }

  @Get('changes')
  @TokenAccess()
  @Permissions('base|read')
  @ResourceMeta('baseId', 'params')
  async changes(
    @Param('baseId') baseId: string,
    @Query('cursor') cursor?: string,
    @Query('since') since?: string,
    @Query('tables') tables?: string | string[],
    @Query('tableIds') tableIds?: string | string[]
  ): Promise<IVcsIncrementalChanges> {
    if (!cursor?.trim()) throw new BadRequestException('Missing required "cursor" query parameter');
    const sinceRevision = parseOptionalNonNegInt(since);
    return this.runWithVcsService(baseId, (c, ctx) =>
      executeListVcsChangesEndpoint(
        ctx,
        { baseId, cursor: cursor.trim(), since: sinceRevision, tables, tableIds },
        c.resolve<ListVcsChangesService>(v2VcsServerTokens.listVcsChangesService)
      )
    );
  }

  @Get('history/checkout')
  @TokenAccess()
  @Permissions('base|read')
  @ResourceMeta('baseId', 'params')
  checkout(
    @Param('baseId') baseId: string,
    @Query(new ZodValidationPipe(vcsCheckoutInputSchema.omit({ baseId: true })))
    query: Omit<IVcsCheckoutInput, 'baseId'>
  ): Promise<{ snapshot: IBaseVcsSnapshot; remoteMode: IVcsHeadInfo['remoteMode'] }> {
    return this.runWithVcsService(baseId, async (c, ctx) => {
      const service = c.resolve<BaseVcsHistoryService>(v2VcsServerTokens.historyService);
      return toVcsEndpointResult(await service.checkout(ctx, { ...query, baseId }));
    });
  }

  @Get('history/diff')
  @TokenAccess()
  @Permissions('base|read')
  @ResourceMeta('baseId', 'params')
  diff(
    @Param('baseId') baseId: string,
    @Query(new ZodValidationPipe(vcsDiffInputSchema.omit({ baseId: true })))
    query: Omit<IVcsDiffInput, 'baseId'>
  ): Promise<IVcsHistoryDiffOutput> {
    return this.runWithVcsService(baseId, async (c, ctx) => {
      const service = c.resolve<BaseVcsHistoryService>(v2VcsServerTokens.historyService);
      return toVcsEndpointResult(await service.diff(ctx, { ...query, baseId }));
    });
  }

  @Post('history/rollback')
  @HttpCode(200)
  @TokenAccess()
  @Permissions('base|update')
  @CanWriteVcs()
  @ResourceMeta('baseId', 'params')
  rollback(
    @Param('baseId') baseId: string,
    @Body(new ZodValidationPipe(vcsRollbackInputSchema.omit({ baseId: true })))
    body: Omit<IVcsRollbackInput, 'baseId'>
  ): Promise<IVcsRollbackOutput> {
    return this.runWithVcsService(baseId, async (c, ctx) => {
      const service = c.resolve<BaseVcsHistoryService>(v2VcsServerTokens.historyService);
      return toVcsEndpointResult(await service.rollback(ctx, { ...body, baseId }));
    });
  }

  @Post('push')
  @TokenAccess()
  @Permissions('base|update')
  @CanWriteVcs()
  @ResourceMeta('baseId', 'params')
  push(@Param('baseId') baseId: string, @Body() body: unknown): Promise<IVcsPushResult> {
    const payload =
      typeof body === 'object' && body !== null && !Array.isArray(body)
        ? { ...body, baseId }
        : body;
    return this.runWithVcsService(baseId, (c, ctx) =>
      executePushVcsPatchEndpoint(
        ctx,
        payload,
        c.resolve<PushVcsPatchService>(v2VcsServerTokens.pushVcsPatchService)
      )
    );
  }
}
