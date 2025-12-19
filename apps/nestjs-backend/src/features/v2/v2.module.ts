import { Module } from '@nestjs/common';
import { ORPCModule } from '@orpc/nest';
import type { Response } from 'express';
import { V2ContainerService } from './v2-container.service';
import { V2OpenApiController } from './v2-openapi.controller';
import { V2Controller } from './v2.controller';

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
      context: {},
      sendResponseInterceptors: [
        async ({ response, standardResponse, next }) => {
          if (standardResponse.status < 400) return next();

          const expressResponse = response as Response;
          expressResponse.status(standardResponse.status);
          for (const [key, value] of Object.entries(standardResponse.headers)) {
            if (value !== undefined) {
              expressResponse.setHeader(key, value);
            }
          }

          return { ok: false as const, error: toErrorMessage(standardResponse.body) };
        },
      ],
    }),
  ],
  controllers: [V2Controller, V2OpenApiController],
  providers: [V2ContainerService],
})
export class V2Module {}
