import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type {
  IV2BaseSchemaIntegrityRepairRo,
  IV2SchemaIntegrityFilterStatus,
  IV2SchemaIntegrityCheckResult,
  IV2SchemaIntegrityDecisionVo,
  IV2SchemaIntegrityRepairResult,
  IV2SchemaIntegrityRepairRo,
} from '@teable/openapi';
import {
  v2SchemaIntegrityFilterStatusSchema,
  v2BaseSchemaIntegrityRepairRoSchema,
  v2SchemaIntegrityRepairRoSchema,
} from '@teable/openapi';
import type { Response as ExpressResponse } from 'express';
import { ClsService } from 'nestjs-cls';
import { z } from 'zod';
import type { IClsStore } from '../../types/cls';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { PermissionGuard } from '../auth/guard/permission.guard';
import { UseV2Feature } from '../canary/decorators/use-v2-feature.decorator';
import { V2FeatureGuard } from '../canary/guards/v2-feature.guard';
import {
  V2IndicatorInterceptor,
  X_TEABLE_V2_FEATURE_HEADER,
  X_TEABLE_V2_HEADER,
  X_TEABLE_V2_REASON_HEADER,
} from '../canary/interceptors/v2-indicator.interceptor';
import { IntegrityV2Service } from './integrity-v2.service';

type IFlushableResponse = ExpressResponse & { flush?: () => void };
type IStreamLifecycleEventBase = {
  fieldId: string;
  fieldName: string;
  ruleId: string;
  ruleDescription: string;
  status: 'success' | 'error';
  message: string;
  required: boolean;
  timestamp: number;
  dependencies: [];
  depth: 0;
};

const sseHeartbeatMs = 15_000;
const v2SchemaIntegrityFeature = 'schemaIntegrity' as const;
const v2SchemaIntegrityFilterQuerySchema = z.object({
  statuses: z.preprocess((value) => {
    if (value == null || value === '') {
      return undefined;
    }

    return Array.isArray(value) ? value : [value];
  }, z.array(v2SchemaIntegrityFilterStatusSchema).optional()),
});

type IV2SchemaIntegrityFilterQuery = {
  statuses?: IV2SchemaIntegrityFilterStatus[];
};

@Controller('api/v2/integrity')
@UseGuards(PermissionGuard, V2FeatureGuard)
export class IntegrityV2Controller {
  constructor(
    private readonly integrityV2Service: IntegrityV2Service,
    private readonly cls: ClsService<IClsStore>
  ) {}

  @Get('base/:baseId/decision')
  @Permissions('base|read')
  @UseV2Feature(v2SchemaIntegrityFeature)
  @UseInterceptors(V2IndicatorInterceptor)
  async getDecision(): Promise<IV2SchemaIntegrityDecisionVo> {
    return {
      feature: v2SchemaIntegrityFeature,
      useV2: this.cls.get('useV2') ?? false,
      reason: this.cls.get('v2Reason') ?? 'disabled',
    };
  }

  @Get('table/:tableId/check-stream')
  @Permissions('table|read')
  @UseV2Feature(v2SchemaIntegrityFeature)
  async checkTable(
    @Param('tableId') tableId: string,
    @Query(new ZodValidationPipe(v2SchemaIntegrityFilterQuerySchema))
    query: IV2SchemaIntegrityFilterQuery,
    @Res() res: ExpressResponse
  ): Promise<void> {
    this.prepareSseResponse(res);
    await this.runSseStream<IV2SchemaIntegrityCheckResult>(res, {
      createStream: () => this.integrityV2Service.createCheckStream(tableId, query.statuses),
      createConnectEvent: () =>
        this.createCheckLifecycleEvent(
          'connect',
          'connection',
          'Schema integrity check stream connected'
        ),
      createCompleteEvent: () =>
        this.createCheckLifecycleEvent(
          'complete',
          'completion',
          'Schema integrity check completed'
        ),
      createErrorEvent: (message) => this.createCheckErrorResult(message),
    });
  }

  @Get('base/:baseId/check-stream')
  @Permissions('base|read')
  @UseV2Feature(v2SchemaIntegrityFeature)
  async checkBase(
    @Param('baseId') baseId: string,
    @Query(new ZodValidationPipe(v2SchemaIntegrityFilterQuerySchema))
    query: IV2SchemaIntegrityFilterQuery,
    @Res() res: ExpressResponse
  ): Promise<void> {
    this.prepareSseResponse(res);
    await this.runSseStream<IV2SchemaIntegrityCheckResult>(res, {
      createStream: () => this.integrityV2Service.createBaseCheckStream(baseId, query.statuses),
      createConnectEvent: () =>
        this.createCheckLifecycleEvent(
          'connect',
          'connection',
          'Base schema integrity check stream connected'
        ),
      createCompleteEvent: () =>
        this.createCheckLifecycleEvent(
          'complete',
          'completion',
          'Base schema integrity check completed'
        ),
      createErrorEvent: (message) => this.createCheckErrorResult(message),
    });
  }

  @Post('table/:tableId/repair-stream')
  @Permissions('table|update')
  @UseV2Feature(v2SchemaIntegrityFeature)
  async repairTable(
    @Param('tableId') tableId: string,
    @Body(new ZodValidationPipe(v2SchemaIntegrityRepairRoSchema))
    repairRo: IV2SchemaIntegrityRepairRo,
    @Res() res: ExpressResponse
  ): Promise<void> {
    this.prepareSseResponse(res);
    await this.runSseStream<IV2SchemaIntegrityRepairResult>(res, {
      createStream: () => this.integrityV2Service.createRepairStream(tableId, repairRo),
      createConnectEvent: () =>
        this.createRepairLifecycleEvent(
          'connect',
          'connection',
          'Schema integrity repair stream connected'
        ),
      createCompleteEvent: () =>
        this.createRepairLifecycleEvent(
          'complete',
          'completion',
          'Schema integrity repair completed'
        ),
      createErrorEvent: (message) => this.createRepairErrorResult(message),
    });
  }

  @Post('base/:baseId/repair-stream')
  @Permissions('base|update')
  @UseV2Feature(v2SchemaIntegrityFeature)
  async repairBase(
    @Param('baseId') baseId: string,
    @Body(new ZodValidationPipe(v2BaseSchemaIntegrityRepairRoSchema))
    repairRo: IV2BaseSchemaIntegrityRepairRo,
    @Res() res: ExpressResponse
  ): Promise<void> {
    this.prepareSseResponse(res);
    await this.runSseStream<IV2SchemaIntegrityRepairResult>(res, {
      createStream: () => this.integrityV2Service.createBaseRepairStream(baseId, repairRo),
      createConnectEvent: () =>
        this.createRepairLifecycleEvent(
          'connect',
          'connection',
          'Base schema integrity repair stream connected'
        ),
      createCompleteEvent: () =>
        this.createRepairLifecycleEvent(
          'complete',
          'completion',
          'Base schema integrity repair completed'
        ),
      createErrorEvent: (message) => this.createRepairErrorResult(message),
    });
  }

  private async runSseStream<T extends { id: string }>(
    res: ExpressResponse,
    options: {
      createStream: () => Promise<AsyncGenerator<T>>;
      createConnectEvent: () => T;
      createCompleteEvent: () => T;
      createErrorEvent: (message: string) => T;
    }
  ): Promise<void> {
    const heartbeat = this.startHeartbeat(res);
    try {
      this.sendSseEvent(res, options.createConnectEvent());

      if (!this.cls.get('useV2')) {
        this.sendSseEvent(res, options.createErrorEvent('V2 schema integrity is not enabled'));
        return;
      }

      const stream = await options.createStream();
      for await (const result of stream) {
        if (this.isStreamClosed(res)) {
          break;
        }
        this.sendSseEvent(res, result);
      }

      this.sendSseEvent(res, options.createCompleteEvent());
    } catch (error) {
      this.sendSseEvent(res, options.createErrorEvent(this.getErrorMessage(error)));
    } finally {
      clearInterval(heartbeat);
      res.end();
    }
  }

  private prepareSseResponse(res: ExpressResponse) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader(X_TEABLE_V2_HEADER, this.cls.get('useV2') ? 'true' : 'false');

    const v2Reason = this.cls.get('v2Reason');
    if (v2Reason) {
      res.setHeader(X_TEABLE_V2_REASON_HEADER, v2Reason);
    }

    const v2Feature = this.cls.get('v2Feature');
    if (v2Feature) {
      res.setHeader(X_TEABLE_V2_FEATURE_HEADER, v2Feature);
    }

    res.flushHeaders();
  }

  private startHeartbeat(res: ExpressResponse) {
    const flushable = res as IFlushableResponse;
    const heartbeat = setInterval(() => {
      if (this.isStreamClosed(res)) {
        return;
      }
      res.write(': ping\n\n');
      flushable.flush?.();
    }, sseHeartbeatMs);

    res.on('close', () => clearInterval(heartbeat));
    return heartbeat;
  }

  private sendSseEvent<T>(res: ExpressResponse, data: T) {
    if (this.isStreamClosed(res)) {
      return;
    }

    const flushable = res as IFlushableResponse;
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    flushable.flush?.();
  }

  private isStreamClosed(res: ExpressResponse): boolean {
    return res.writableEnded || res.destroyed;
  }

  private createCheckErrorResult(message: string): IV2SchemaIntegrityCheckResult {
    return {
      ...this.createLifecycleEventBase(
        'error:unexpected',
        'unexpected',
        'Unexpected error',
        'error',
        message
      ),
    };
  }

  private createRepairErrorResult(message: string): IV2SchemaIntegrityRepairResult {
    return {
      ...this.createLifecycleEventBase(
        'error:unexpected',
        'unexpected',
        'Unexpected error',
        'error',
        message
      ),
      outcome: 'manual',
    };
  }

  private createCheckLifecycleEvent(
    id: 'connect' | 'complete',
    ruleId: 'connection' | 'completion',
    message: string
  ): IV2SchemaIntegrityCheckResult {
    return {
      ...this.createLifecycleEventBase(id, ruleId, this.capitalize(ruleId), 'success', message),
    };
  }

  private createRepairLifecycleEvent(
    id: 'connect' | 'complete',
    ruleId: 'connection' | 'completion',
    message: string
  ): IV2SchemaIntegrityRepairResult {
    return {
      ...this.createLifecycleEventBase(id, ruleId, this.capitalize(ruleId), 'success', message),
      outcome: 'unchanged',
    };
  }

  private createLifecycleEventBase(
    id: string,
    ruleId: string,
    ruleDescription: string,
    status: IStreamLifecycleEventBase['status'],
    message: string
  ): IStreamLifecycleEventBase & { id: string } {
    return {
      id,
      fieldId: '',
      fieldName: '',
      ruleId,
      ruleDescription,
      status,
      message,
      required: true,
      timestamp: Date.now(),
      dependencies: [],
      depth: 0,
    };
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return 'Unknown schema integrity stream error';
  }

  private capitalize(value: string): string {
    return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
  }
}
