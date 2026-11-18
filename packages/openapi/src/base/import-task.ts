import { z } from '../zod';

/**
 * Shared shapes for the background-task flavour of the source importers
 * (Airtable, Google Sheets). The streaming routes tie the whole import to one
 * long-lived SSE connection; the task routes start the same import in the
 * background and report on it through short polling requests, so a client that
 * is killed or times out can pick the import up again instead of restarting it.
 */

export const importTaskStatusSchema = z.enum(['running', 'completed', 'failed']);

export type IImportTaskStatus = z.infer<typeof importTaskStatusSchema>;

export const importTaskOptionsRoSchema = z.object({
  force: z
    .boolean()
    .optional()
    .meta({
      description:
        'Start a fresh import even when an identical one finished moments ago. Without it, ' +
        'repeating a just-finished request returns that finished task instead of importing ' +
        'the same data twice. An import that is still running is never started twice.',
    }),
});

export const importTaskSubmitVoSchema = z.object({
  taskId: z.string(),
  status: importTaskStatusSchema,
  reused: z.boolean().meta({
    description:
      'True when no new import was started: the returned task is one that is already running ' +
      '(or just finished) for the same source and target.',
  }),
  sameOptions: z
    .boolean()
    .optional()
    .meta({
      description:
        'Set when reused is true: false when the returned task was started with other import ' +
        'options than this request asked for, so the options of this request are not applied.',
    }),
});

export type IImportTaskSubmitVo = z.infer<typeof importTaskSubmitVoSchema>;

export const importTaskProgressSchema = z.object({
  phase: z.string(),
  detail: z.string().optional(),
  tableName: z.string().optional(),
  tableIndex: z.number().optional(),
  totalTables: z.number().optional(),
  processedRows: z.number().optional(),
  totalRows: z.number().optional(),
  importedRecords: z.number().optional(),
});

export type IImportTaskProgress = z.infer<typeof importTaskProgressSchema>;

/**
 * `errorShape` adds source-specific fields to the failure, e.g. what a partly
 * failed import had already finished.
 */
export const createImportTaskVoSchema = <TResult extends z.ZodType, TError extends z.ZodRawShape>(
  resultSchema: TResult,
  errorShape: TError
) =>
  z.object({
    taskId: z.string(),
    status: importTaskStatusSchema,
    baseId: z
      .string()
      .optional()
      .meta({
        description:
          'The project the import writes into, once known. Set even when the import failed or was ' +
          'interrupted, so whatever it had already created can be found.',
      }),
    progress: importTaskProgressSchema.optional().meta({
      description: 'The latest progress event of the import.',
    }),
    result: resultSchema.optional().meta({
      description: 'The import result. Present only when status is "completed".',
    }),
    error: z
      .object({ message: z.string(), ...errorShape })
      .optional()
      .meta({ description: 'Why the import failed. Present only when status is "failed".' }),
    createdTime: z.string(),
    lastModifiedTime: z.string(),
  });
