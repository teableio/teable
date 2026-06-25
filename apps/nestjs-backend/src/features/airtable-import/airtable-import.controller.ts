import { BadRequestException, Body, Controller, Logger, Post, Res } from '@nestjs/common';
import { type Action } from '@teable/core';
import {
  importAirtableAnalyzeRoSchema,
  importAirtableRoSchema,
  type IImportAirtableAnalyzeRo,
  type IImportAirtableAnalyzeVo,
  type IImportAirtableRo,
} from '@teable/openapi';
import { Response as ExpressResponse } from 'express';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { PermissionService } from '../auth/permission.service';
import { AirtableApiError } from './airtable-api.client';
import { AirtableImportService } from './airtable-import.service';

const formatAirtableImportError = (error: unknown): string => {
  if (error instanceof AirtableApiError) {
    if (error.status === 401) {
      return 'Airtable rejected the access token. Check that the token is valid.';
    }
    if (error.status === 403 || error.status === 404) {
      return 'Airtable base not accessible. Grant the token access to the base and the "data.records:read" and "schema.bases:read" scopes.';
    }
    return `Airtable API error: ${error.message}`;
  }
  return error instanceof Error && error.message ? error.message : 'Unknown import error';
};

@Controller('api/base')
export class AirtableImportController {
  private readonly logger = new Logger(AirtableImportController.name);

  constructor(
    private readonly airtableImportService: AirtableImportService,
    private readonly permissionService: PermissionService,
    private readonly cls: ClsService<IClsStore>
  ) {}

  @Post('import-airtable/analyze')
  async analyze(
    @Body(new ZodValidationPipe(importAirtableAnalyzeRoSchema))
    analyzeRo: IImportAirtableAnalyzeRo
  ): Promise<IImportAirtableAnalyzeVo> {
    try {
      return await this.airtableImportService.analyze(analyzeRo);
    } catch (error) {
      if (error instanceof AirtableApiError) {
        throw new BadRequestException(formatAirtableImportError(error));
      }
      throw error;
    }
  }

  @Post('import-airtable/stream')
  async importStream(
    @Body(new ZodValidationPipe(importAirtableRoSchema))
    importAirtableRo: IImportAirtableRo,
    @Res() res: ExpressResponse
  ) {
    // Authorize the real write target before doing anything: importing into an
    // existing base needs table-import rights on THAT base — not base|create on
    // whatever space the caller passes — while creating a new base needs
    // base|create on the target space. (validPermissions intersects token scopes.)
    const targetResourceId = importAirtableRo.baseId ?? importAirtableRo.spaceId;
    if (!targetResourceId) {
      // Unreachable via the zod schema (spaceId is required when baseId is absent),
      // but keep the guard so the permission target is always a concrete resource.
      throw new BadRequestException('Either baseId or spaceId is required.');
    }
    const requiredPermissions: Action[] = importAirtableRo.baseId
      ? ['base|table_import']
      : ['base|create'];
    await this.permissionService.validPermissions(
      targetResourceId,
      requiredPermissions,
      this.cls.get('accessTokenId')
    );

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
      this.logger.warn(
        `[airtable-import] failed airtableBase=${importAirtableRo.airtableBaseId} ` +
          `target=${importAirtableRo.baseId ?? 'new'} reason=${reason}`
      );
      sendEvent({ type: 'error', message: reason });
    } finally {
      clearInterval(heartbeat);
      res.end();
    }
  }
}
