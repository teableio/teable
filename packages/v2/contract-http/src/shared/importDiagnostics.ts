import type { IImportDiagnostics } from '@teable/v2-core';
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

/** Wire shape of {@link importDiagnosticsDtoSchema}; samples are plain arrays, not the core readonly view. */
export type IImportDiagnosticsDto = z.infer<typeof importDiagnosticsDtoSchema>;

/** Copies the core readonly diagnostics view into the mutable wire shape the response schema infers. */
export const mapImportDiagnosticsToDto = (
  diagnostics: IImportDiagnostics | undefined
): IImportDiagnosticsDto | undefined =>
  diagnostics
    ? {
        invalidDateCells: diagnostics.invalidDateCells,
        skippedRows: diagnostics.skippedRows,
        samples: [...diagnostics.samples],
      }
    : undefined;
