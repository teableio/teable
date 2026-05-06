import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { BaseId } from '../domain/base/BaseId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { DotTeaSource } from '../ports/DotTeaParser';

const importDotTeaBaseSchema = z.object({
  baseId: z.string(),
});

type ImportDotTeaStructureTableProgressEvent = {
  phase: 'table_structure_started' | 'table_structure_done';
  tableId: string;
  tableName: string;
  tableIndex: number;
  totalTables: number;
};

type ImportDotTeaStructurePhaseProgressEvent = {
  phase: 'table_structure_validating' | 'table_structure_committing';
};

export type ImportDotTeaStructureProgressEvent =
  | ImportDotTeaStructureTableProgressEvent
  | ImportDotTeaStructurePhaseProgressEvent;

export class ImportDotTeaStructureCommand {
  private constructor(
    readonly baseId: BaseId,
    readonly source: DotTeaSource,
    readonly commitInSingleTransaction: boolean,
    readonly onProgress?: (event: ImportDotTeaStructureProgressEvent) => void
  ) {}

  static createFromSource(input: {
    baseId: string;
    source: DotTeaSource;
    commitInSingleTransaction?: boolean;
    onProgress?: (event: ImportDotTeaStructureProgressEvent) => void;
  }): Result<ImportDotTeaStructureCommand, DomainError> {
    const parsed = importDotTeaBaseSchema.safeParse({ baseId: input.baseId });
    if (!parsed.success) {
      return err(
        domainError.validation({
          message: 'Invalid ImportDotTeaStructureCommand input',
          details: z.formatError(parsed.error),
        })
      );
    }

    return BaseId.create(parsed.data.baseId).map(
      (baseId) =>
        new ImportDotTeaStructureCommand(
          baseId,
          input.source,
          input.commitInSingleTransaction ?? true,
          input.onProgress
        )
    );
  }

  static createFromBuffer(input: {
    baseId: string;
    dotTeaData: Uint8Array;
    commitInSingleTransaction?: boolean;
    onProgress?: (event: ImportDotTeaStructureProgressEvent) => void;
  }): Result<ImportDotTeaStructureCommand, DomainError> {
    return ImportDotTeaStructureCommand.createFromSource({
      baseId: input.baseId,
      source: { type: 'buffer', data: input.dotTeaData },
      commitInSingleTransaction: input.commitInSingleTransaction,
      onProgress: input.onProgress,
    });
  }

  static createFromStream(input: {
    baseId: string;
    dotTeaStream: AsyncIterable<Uint8Array>;
    commitInSingleTransaction?: boolean;
    onProgress?: (event: ImportDotTeaStructureProgressEvent) => void;
  }): Result<ImportDotTeaStructureCommand, DomainError> {
    return ImportDotTeaStructureCommand.createFromSource({
      baseId: input.baseId,
      source: { type: 'stream', data: input.dotTeaStream },
      commitInSingleTransaction: input.commitInSingleTransaction,
      onProgress: input.onProgress,
    });
  }

  static createFromPath(input: {
    baseId: string;
    path: string;
    commitInSingleTransaction?: boolean;
    onProgress?: (event: ImportDotTeaStructureProgressEvent) => void;
  }): Result<ImportDotTeaStructureCommand, DomainError> {
    if (!input.path) {
      return err(
        domainError.validation({
          message: 'dottea path is required',
          code: 'dottea.path_missing',
        })
      );
    }

    return ImportDotTeaStructureCommand.createFromSource({
      baseId: input.baseId,
      source: { type: 'path', path: input.path },
      commitInSingleTransaction: input.commitInSingleTransaction,
      onProgress: input.onProgress,
    });
  }
}
