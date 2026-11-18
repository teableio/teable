import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Logger,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import { HttpErrorCode, type Action } from '@teable/core';
import {
  importAirtableAnalyzeRoSchema,
  importAirtableRoSchema,
  importAirtableTaskRoSchema,
  type IImportAirtableAnalyzeRo,
  type IImportAirtableAnalyzeVo,
  type IImportAirtableRo,
  type IImportAirtableTaskRo,
  type IImportAirtableTaskVo,
  type IImportAirtableVo,
  type IImportTaskSubmitVo,
} from '@teable/openapi';
import { Response as ExpressResponse } from 'express';
import { ClsService } from 'nestjs-cls';
import { CustomHttpException } from '../../custom.exception';
import type { IClsStore } from '../../types/cls';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { TokenAccess } from '../auth/decorators/token.decorator';
import { PermissionService } from '../auth/permission.service';
import { BaseNodeService } from '../base-node/base-node.service';
import { SourceImportTaskService } from '../source-import-task/source-import-task.service';
import { AirtableApiError } from './airtable-api.client';
import { AirtableImportService } from './airtable-import.service';

/** `prefixed: false` leaves out the "Airtable API error:" label, for callers that add their own prefix. */
const formatAirtableImportError = (error: unknown, { prefixed = true } = {}): string => {
  if (error instanceof AirtableApiError) {
    if (error.status === 401) {
      return 'Airtable rejected the access token. Check that the token is valid.';
    }
    if (error.status === 403 || error.status === 404) {
      return 'Airtable base not accessible. Grant the token access to the base and the "data.records:read" and "schema.bases:read" scopes.';
    }
    return prefixed ? `Airtable API error: ${error.message}` : error.message;
  }
  return error instanceof Error && error.message ? error.message : 'Unknown import error';
};

@Controller('api/base')
export class AirtableImportController {
  private readonly logger = new Logger(AirtableImportController.name);

  constructor(
    private readonly airtableImportService: AirtableImportService,
    private readonly permissionService: PermissionService,
    private readonly baseNodeService: BaseNodeService,
    private readonly cls: ClsService<IClsStore>,
    private readonly importTaskService: SourceImportTaskService
  ) {}

  /**
   * Stored integration credentials are guarded by the user|integrations scope
   * on /api/user-integrations; a PAT reaching these @TokenAccess routes with
   * an integrationId must carry that same scope or it could use (and probe)
   * the owner's stored Airtable OAuth token without ever being granted it.
   */
  private async assertIntegrationScope(integrationId: string | undefined): Promise<void> {
    if (!integrationId) return;
    const accessTokenId = this.cls.get('accessTokenId');
    if (!accessTokenId) return;
    const { scopes } = await this.permissionService.getAccessToken(accessTokenId);
    if (!scopes.includes('user|integrations')) {
      throw new ForbiddenException(
        'The access token requires the user|integrations scope to use a stored integration credential.'
      );
    }
  }

  // Personal access tokens may call these routes (the guard blocks PATs on
  // permissionless routes by default); the stream handler checks the concrete
  // write target itself via validPermissions below.
  @TokenAccess()
  @Post('import-airtable/analyze')
  async analyze(
    @Body(new ZodValidationPipe(importAirtableAnalyzeRoSchema))
    analyzeRo: IImportAirtableAnalyzeRo
  ): Promise<IImportAirtableAnalyzeVo> {
    await this.assertIntegrationScope(analyzeRo.integrationId);
    try {
      return await this.airtableImportService.analyze(analyzeRo);
    } catch (error) {
      if (error instanceof AirtableApiError) {
        throw new CustomHttpException(
          formatAirtableImportError(error),
          HttpErrorCode.VALIDATION_ERROR,
          {
            localization: {
              i18nKey: 'httpErrors.import.failed',
              // the localized "Import failed:" prefix stands in for the English label
              context: { detail: formatAirtableImportError(error, { prefixed: false }) },
            },
          }
        );
      }
      throw error;
    }
  }

  /**
   * Everything an import request must pass before any work starts, shared by
   * the stream and the task route. Returns the request with its folder resolved.
   */
  private async authorizeImport(importAirtableRo: IImportAirtableRo): Promise<IImportAirtableRo> {
    // Authorize the real write target before doing anything: importing into an
    // existing base needs table-import rights on THAT base — not base|create on
    // whatever space the caller passes — while creating a new base needs
    // base|create on the target space. (validPermissions intersects token scopes.)
    const targetResourceId = importAirtableRo.baseId ?? importAirtableRo.spaceId;
    if (!targetResourceId) {
      // Unreachable via the zod schema (spaceId is required when baseId is absent),
      // but keep the guard so the permission target is always a concrete resource.
      throw new CustomHttpException(
        'Either baseId or spaceId is required.',
        HttpErrorCode.VALIDATION_ERROR
      );
    }
    const requiredPermissions: Action[] = importAirtableRo.baseId
      ? ['base|table_import']
      : ['base|create'];
    await this.permissionService.validPermissions(
      targetResourceId,
      requiredPermissions,
      this.cls.get('accessTokenId')
    );
    await this.assertIntegrationScope(importAirtableRo.integrationId);
    // fail fast: once the import has started, errors only surface as stream events or task state
    if (importAirtableRo.folderId && importAirtableRo.baseId) {
      const folderNodeId = await this.baseNodeService.resolveFolderNodeId(
        importAirtableRo.baseId,
        importAirtableRo.folderId
      );
      return { ...importAirtableRo, folderId: folderNodeId };
    }
    return importAirtableRo;
  }

  private logImportFailure(importAirtableRo: IImportAirtableRo, reason: string): void {
    this.logger.warn(
      `[airtable-import] failed airtableBase=${importAirtableRo.airtableBaseId} ` +
        `target=${importAirtableRo.baseId ?? 'new'} reason=${reason}`
    );
  }

  /**
   * Starts the import in the background and returns its task id at once, so the
   * client polls with short requests instead of holding one connection open for
   * the whole import. Asking again for the same Airtable base and destination
   * while it runs returns the running task.
   */
  @TokenAccess()
  @Post('import-airtable/tasks')
  async createImportTask(
    @Body(new ZodValidationPipe(importAirtableTaskRoSchema))
    taskRo: IImportAirtableTaskRo
  ): Promise<IImportTaskSubmitVo> {
    const { force, ...ro } = taskRo;
    const importAirtableRo = await this.authorizeImport(ro);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- credentials stay out of the digest
    const { accessToken, integrationId, ...request } = importAirtableRo;
    return this.importTaskService.submit<IImportAirtableVo>({
      source: 'airtable',
      userId: this.cls.get('user.id'),
      scope: {
        airtableBaseId: importAirtableRo.airtableBaseId,
        // Where the import goes, not how it is imported: a retry with other
        // options still finds the running task, another destination does not.
        target: importAirtableRo.baseId
          ? { baseId: importAirtableRo.baseId, folderId: importAirtableRo.folderId ?? null }
          : { spaceId: importAirtableRo.spaceId, baseName: importAirtableRo.baseName },
      },
      fingerprint: request,
      force,
      run: (report, setBaseId) =>
        this.airtableImportService.importBase(importAirtableRo, report, setBaseId),
      toFailure: (error) => {
        const reason = formatAirtableImportError(error);
        this.logImportFailure(importAirtableRo, reason);
        return { error: { message: reason } };
      },
    });
  }

  @TokenAccess()
  @Get('import-airtable/tasks/:taskId')
  async getImportTask(@Param('taskId') taskId: string): Promise<IImportAirtableTaskVo> {
    return this.importTaskService.get<IImportAirtableVo>(
      'airtable',
      this.cls.get('user.id'),
      taskId
    );
  }

  @TokenAccess()
  @Post('import-airtable/stream')
  async importStream(
    @Body(new ZodValidationPipe(importAirtableRoSchema))
    importAirtableRo: IImportAirtableRo,
    @Res() res: ExpressResponse
  ) {
    importAirtableRo = await this.authorizeImport(importAirtableRo);

    const sseHeartbeatMs = 15_000;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const isStreamClosed = () => res.writableEnded || res.destroyed;
    const sendEvent = (data: unknown) => {
      if (isStreamClosed()) return;
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      (res as ExpressResponse & { flush?: () => void }).flush?.();
    };
    const heartbeat = setInterval(() => {
      if (isStreamClosed()) return;
      res.write(': ping\n\n');
      (res as ExpressResponse & { flush?: () => void }).flush?.();
    }, sseHeartbeatMs);
    res.on('close', () => clearInterval(heartbeat));

    try {
      const result = await this.airtableImportService.importBase(importAirtableRo, (progress) => {
        sendEvent({ type: 'progress', ...progress });
      });
      sendEvent({ type: 'done', data: result });
    } catch (error) {
      const reason = formatAirtableImportError(error);
      this.logImportFailure(importAirtableRo, reason);
      sendEvent({ type: 'error', message: reason });
    } finally {
      clearInterval(heartbeat);
      res.end();
    }
  }
}
