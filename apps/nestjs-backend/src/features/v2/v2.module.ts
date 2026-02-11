import { Module } from '@nestjs/common';
import { ORPCModule } from '@orpc/nest';
import type { Response } from 'express';
import { LoggerModule } from '../../logger/logger.module';
import { ShareDbModule } from '../../share-db/share-db.module';
import { UndoRedoStackService } from '../undo-redo/stack/undo-redo-stack.service';
import { V2ActionTriggerService } from './v2-action-trigger.service';
import { V2ContainerService } from './v2-container.service';
import { V2ExecutionContextFactory } from './v2-execution-context.factory';
import { V2OpenApiController } from './v2-openapi.controller';
import { V2RecordHistoryService } from './v2-record-history.service';
import { V2UndoRedoService } from './v2-undo-redo.service';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const formatIssuePath = (path: unknown): string => {
  if (typeof path === 'string') return path;
  if (!Array.isArray(path) || path.length === 0) return '';

  let formatted = '';
  for (const segment of path) {
    if (typeof segment === 'number') {
      formatted += `[${segment}]`;
      continue;
    }
    const text = String(segment);
    formatted = formatted ? `${formatted}.${text}` : text;
  }

  return formatted;
};

const formatIssue = (issue: unknown): string | null => {
  if (!isRecord(issue)) return null;

  const message = typeof issue.message === 'string' ? issue.message : '';
  const path = formatIssuePath(issue.path);

  if (message && path) return `${path}: ${message}`;
  if (message) return message;
  if (path) return path;
  return null;
};

const formatIssues = (data: unknown): string[] => {
  if (!isRecord(data)) return [];
  const issues = data.issues;
  if (!Array.isArray(issues)) return [];

  return issues.map(formatIssue).filter((issue): issue is string => Boolean(issue));
};

const toErrorMessage = (body: unknown): string => {
  if (typeof body === 'string') return body;
  if (!isRecord(body)) return 'Unexpected error';

  const message = typeof body.message === 'string' ? body.message : 'Unexpected error';
  const issues = formatIssues(body.data);
  if (issues.length > 0) return `${message}: ${issues.join('; ')}`;

  return message;
};

@Module({
  imports: [
    ORPCModule.forRoot({
      sendResponseInterceptors: [
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async (options: any) => {
          const { response, standardResponse, next } = options;
          if (standardResponse.status < 400) return next();

          const expressResponse = response as Response;
          expressResponse.status(standardResponse.status);
          for (const [key, value] of Object.entries(standardResponse.headers)) {
            if (value != null) {
              expressResponse.setHeader(
                key,
                value as unknown as string | number | readonly string[]
              );
            }
          }

          return { ok: false as const, error: toErrorMessage(standardResponse.body) };
        },
      ],
    }),
    LoggerModule.register(),
    ShareDbModule,
  ],
  controllers: [V2OpenApiController],
  providers: [
    V2ContainerService,
    V2ExecutionContextFactory,
    V2ActionTriggerService,
    V2RecordHistoryService,
    V2UndoRedoService,
    UndoRedoStackService,
  ],
  exports: [V2ContainerService, V2ExecutionContextFactory],
})
export class V2Module {}
