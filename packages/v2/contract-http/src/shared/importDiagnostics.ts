import { z } from 'zod';

export const importDiagnosticsDtoSchema = z.object({
  invalidDateCells: z.number().int().nonnegative(),
  skippedRows: z.number().int().nonnegative(),
  samples: z
    .array(
      z.object({
        rowNumber: z.number().int().positive(),
        fieldId: z.string().optional(),
        fieldName: z.string().optional(),
        reason: z.enum(['invalidDate', 'invalidRow']),
        code: z.string(),
        message: z.string(),
      })
    )
    .max(100),
});
