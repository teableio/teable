import { localizationSchema } from '@teable/core';
import type { ITableFullVo } from '../table';
import { z } from '../zod';
import { createImportStreamError } from './stream-error';

export const importStreamProgressEventSchema = z.object({
  id: z.literal('progress'),
  phase: z.enum(['preparing', 'parsing', 'importing']),
  sheetIndex: z.number(),
  sheetCount: z.number(),
  sheetName: z.string().optional(),
  tableName: z.string().optional(),
  batchIndex: z.number(),
  totalCount: z.number(),
  processedCount: z.number(),
  importedCount: z.number(),
  sheetTotalCount: z.number(),
  sheetProcessedCount: z.number(),
  batchProcessedCount: z.number(),
});

export const importSheetSummarySchema = z.object({
  name: z.string(),
  importedCount: z.number(),
  truncated: z.boolean(),
  error: z.string().optional(),
});

export const importStreamDoneEventSchema = z.object({
  id: z.literal('done'),
  totalCount: z.number(),
  processedCount: z.number(),
  importedCount: z.number(),
  data: z.object({
    tables: z.array(z.unknown()).optional(),
    tableId: z.string().optional(),
    sheets: z.array(importSheetSummarySchema).optional(),
  }),
});

export const importStreamErrorEventSchema = z.object({
  id: z.literal('error'),
  phase: z.enum(['preparing', 'parsing', 'importing', 'finalizing']),
  sheetIndex: z.number(),
  sheetCount: z.number(),
  sheetName: z.string().optional(),
  batchIndex: z.number(),
  totalCount: z.number(),
  processedCount: z.number(),
  importedCount: z.number(),
  message: z.string(),
  code: z.string().optional(),
  localization: localizationSchema.optional(),
});

export const importStreamEventSchema = z.union([
  importStreamProgressEventSchema,
  importStreamDoneEventSchema,
  importStreamErrorEventSchema,
]);

export type IImportSheetSummary = z.infer<typeof importSheetSummarySchema>;
export type IImportStreamProgressEvent = z.infer<typeof importStreamProgressEventSchema>;
export type IImportStreamDoneEvent = z.infer<typeof importStreamDoneEventSchema> & {
  data: {
    tables?: ITableFullVo[];
    tableId?: string;
    sheets?: IImportSheetSummary[];
  };
};
export type IImportStreamErrorEvent = z.infer<typeof importStreamErrorEventSchema>;
export type IImportStreamEvent =
  | IImportStreamProgressEvent
  | IImportStreamDoneEvent
  | IImportStreamErrorEvent;

export type IImportStreamClientResult = {
  done: IImportStreamDoneEvent;
  errors: IImportStreamErrorEvent[];
};

export const reduceImportStreamEvent = (
  event: IImportStreamEvent,
  options?: {
    onProgress?: (event: IImportStreamProgressEvent) => void;
    onError?: (event: IImportStreamErrorEvent) => void;
  }
): { done?: IImportStreamDoneEvent; error?: IImportStreamErrorEvent } => {
  switch (event.id) {
    case 'progress':
      options?.onProgress?.(event);
      return {};
    case 'done':
      return { done: event };
    case 'error':
      options?.onError?.(event);
      return { error: event };
  }
};

export const finishImportStream = (
  doneEvent: IImportStreamDoneEvent | null,
  errors: IImportStreamErrorEvent[],
  emptyMessage: string
): IImportStreamClientResult => {
  if (!doneEvent) {
    const lastError = errors.at(-1);
    if (lastError) {
      throw createImportStreamError(lastError);
    }
    throw new Error(emptyMessage);
  }
  return { done: doneEvent, errors };
};
