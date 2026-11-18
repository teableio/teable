import type { DomainError } from '../../domain/shared/DomainError';
import type { Field } from '../../domain/table/fields/Field';
import type { IImportDiagnostics } from '../../ports/import/IImportSource';

/** Per-import counters with a bounded, raw-value-free diagnostic sample. */
export class ImportDiagnosticsCollector {
  private invalidDateCells = 0;
  private skippedRows = 0;
  private readonly samples: IImportDiagnostics['samples'][number][] = [];

  invalidDate(rowNumber: number, field: Field): void {
    this.invalidDateCells++;
    if (this.samples.length >= 100) return;
    this.samples.push({
      rowNumber,
      fieldId: field.id().toString(),
      fieldName: field.name().toString(),
      reason: 'invalidDate',
      code: 'validation.field.invalid_date',
      message: 'Invalid date value was cleared.',
    });
  }

  invalidRow(rowNumber: number, error: DomainError): void {
    this.skippedRows++;
    if (this.samples.length >= 100) return;
    const fieldId = error.details?.fieldId;
    const fieldName = error.details?.fieldName;
    this.samples.push({
      rowNumber,
      ...(typeof fieldId === 'string' ? { fieldId } : {}),
      ...(typeof fieldName === 'string' ? { fieldName } : {}),
      reason: 'invalidRow',
      code: error.code,
      message: 'Row could not satisfy field validation and was skipped.',
    });
  }

  snapshot(): IImportDiagnostics | undefined {
    if (this.invalidDateCells === 0 && this.skippedRows === 0) return undefined;
    return {
      invalidDateCells: this.invalidDateCells,
      skippedRows: this.skippedRows,
      samples: [...this.samples],
    };
  }
}
