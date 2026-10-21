import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Logger,
  NotFoundException,
  Post,
  Res,
} from '@nestjs/common';
import { type Action } from '@teable/core';
import {
  importGoogleSheetAnalyzeRoSchema,
  importGoogleSheetRoSchema,
  type IGoogleSheetPickerConfigVo,
  type IImportGoogleSheetAnalyzeRo,
  type IImportGoogleSheetAnalyzeVo,
  type IImportGoogleSheetRo,
} from '@teable/openapi';
import { Response as ExpressResponse } from 'express';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { TokenAccess } from '../auth/decorators/token.decorator';
import { PermissionService } from '../auth/permission.service';
import { GoogleSheetApiError } from './google-sheet-api.client';
import {
  GoogleSheetImportPartialError,
  GoogleSheetImportService,
} from './google-sheet-import.service';

const formatGoogleSheetImportError = (error: unknown): string => {
  if (error instanceof GoogleSheetApiError) {
    if (error.status === 401) {
      return 'Google rejected the access token. Reconnect the Google Sheets integration.';
    }
    if (error.status === 403 || error.status === 404) {
      return error.authMode === 'apiKey'
        ? 'Spreadsheet not accessible without signing in. Share it as "anyone with the link", or connect the Google Sheets integration and pick it in the Google Picker.'
        : 'Spreadsheet not accessible. The drive.file grant only covers files picked through the Google Picker — pick the spreadsheet again.';
    }
    return `Google Sheets API error: ${error.message}`;
  }
  return error instanceof Error && error.message ? error.message : 'Unknown import error';
};

@Controller('api/base')
export class GoogleSheetImportController {
  private readonly logger = new Logger(GoogleSheetImportController.name);

  constructor(
    private readonly googleSheetImportService: GoogleSheetImportService,
    private readonly permissionService: PermissionService,
    private readonly cls: ClsService<IClsStore>
  ) {}

  /**
   * Stored integration credentials are guarded by the user|integrations scope
   * on /api/user-integrations; a PAT reaching these @TokenAccess routes with
   * an integrationId must carry that same scope or it could use (and probe)
   * the owner's stored Google OAuth token without ever being granted it.
   */
  private async assertIntegrationScope(integrationId: string | undefined): Promise<void> {
    if (!integrationId) return;
    await this.assertPatIntegrationsScope();
  }

  /**
   * PATs must hold user|integrations to touch these routes at all: without a
   * gate, a zero-scope token could use the analyze route as a Google-token
   * validity oracle or drive server-side traffic through the instance's
   * shared public API key. Browser sessions (no accessTokenId) pass through.
   */
  private async assertPatIntegrationsScope(): Promise<void> {
    const accessTokenId = this.cls.get('accessTokenId');
    if (!accessTokenId) return;
    const { scopes } = await this.permissionService.getAccessToken(accessTokenId);
    if (!scopes.includes('user|integrations')) {
      throw new ForbiddenException(
        'The access token requires the user|integrations scope for Google Sheets import routes.'
      );
    }
  }

  /**
   * Client config for opening the Google Picker in the browser. Both values
   * are public by design: the API key is referrer-restricted in the Google
   * console and the app id is the Cloud project number.
   */
  @Get('import-google-sheet/picker-config')
  pickerConfig(): IGoogleSheetPickerConfigVo {
    const apiKey = process.env.GOOGLE_SHEET_PICKER_API_KEY;
    const clientId = process.env.BACKEND_GOOGLE_CLIENT_ID;
    if (!apiKey || !clientId) {
      throw new NotFoundException('Google Sheets import is not configured on this instance');
    }
    // BACKEND_GOOGLE_CLIENT_ID is shared with Google sign-in — one OAuth app
    // serves both. A client id is "<project number>-<hash>.apps.googleusercontent.com"
    // and the Picker's appId is exactly that project number, so no extra env
    // var — but the Picker API key MUST live in the same GCP project.
    const appId = clientId.split('-')[0];
    if (!/^\d+$/.test(appId)) {
      throw new NotFoundException('BACKEND_GOOGLE_CLIENT_ID does not look like a Google client id');
    }
    return { apiKey, appId };
  }

  // Personal access tokens may call these routes (the guard blocks PATs on
  // permissionless routes by default); the stream handler checks the concrete
  // write target itself via validPermissions below.
  @TokenAccess()
  @Post('import-google-sheet/analyze')
  async analyze(
    @Body(new ZodValidationPipe(importGoogleSheetAnalyzeRoSchema))
    analyzeRo: IImportGoogleSheetAnalyzeRo
  ): Promise<IImportGoogleSheetAnalyzeVo> {
    await this.assertPatIntegrationsScope();
    try {
      return await this.googleSheetImportService.analyze(analyzeRo);
    } catch (error) {
      if (error instanceof GoogleSheetApiError) {
        throw new BadRequestException(formatGoogleSheetImportError(error));
      }
      throw error;
    }
  }

  @TokenAccess()
  @Post('import-google-sheet/stream')
  async importStream(
    @Body(new ZodValidationPipe(importGoogleSheetRoSchema))
    importGoogleSheetRo: IImportGoogleSheetRo,
    @Res() res: ExpressResponse
  ) {
    // Authorize the real write target before doing anything: importing into an
    // existing base needs table-import rights on THAT base — not base|create on
    // whatever space the caller passes — while creating a new base needs
    // base|create on the target space. (validPermissions intersects token scopes.)
    const targetResourceId = importGoogleSheetRo.baseId ?? importGoogleSheetRo.spaceId;
    if (!targetResourceId) {
      // Unreachable via the zod schema (spaceId is required when baseId is absent),
      // but keep the guard so the permission target is always a concrete resource.
      throw new BadRequestException('Either baseId or spaceId is required.');
    }
    const requiredPermissions: Action[] = importGoogleSheetRo.baseId
      ? ['base|table_import']
      : ['base|create'];
    await this.permissionService.validPermissions(
      targetResourceId,
      requiredPermissions,
      this.cls.get('accessTokenId')
    );
    await this.assertIntegrationScope(importGoogleSheetRo.integrationId);

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
      const result = await this.googleSheetImportService.importSpreadsheet(
        importGoogleSheetRo,
        (progress) => {
          sendEvent({ type: 'progress', ...progress });
        },
        isStreamClosed
      );
      sendEvent({ type: 'done', data: result });
    } catch (error) {
      // A partial failure keeps everything imported before the error; unwrap
      // the underlying cause for the message and attach the partial result so
      // the client can keep it instead of reporting a total loss.
      const cause = error instanceof GoogleSheetImportPartialError ? error.cause : error;
      const reason = formatGoogleSheetImportError(cause);
      const partial = error instanceof GoogleSheetImportPartialError ? error.partial : undefined;
      this.logger.warn(
        `[google-sheet-import] failed spreadsheet=${importGoogleSheetRo.spreadsheetId} ` +
          `target=${importGoogleSheetRo.baseId ?? 'new'} ` +
          `partialTables=${partial ? Object.keys(partial.tableIdMap).length : 0} reason=${reason}`
      );
      sendEvent({ type: 'error', message: reason, ...(partial ? { partial } : {}) });
    } finally {
      clearInterval(heartbeat);
      res.end();
    }
  }
}
