import { err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

import { BaseId } from '../domain/base/BaseId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { DotTeaSource } from '../ports/DotTeaParser';

const importDotTeaBaseSchema = z.object({
  baseId: z.string(),
});

export class ImportDotTeaStructureCommand {
  private constructor(
    readonly baseId: BaseId,
    readonly source: DotTeaSource
  ) {}

  static createFromSource(input: {
    baseId: string;
    source: DotTeaSource;
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
      (baseId) => new ImportDotTeaStructureCommand(baseId, input.source)
    );
  }

  static createFromBuffer(input: {
    baseId: string;
    dotTeaData: Uint8Array;
  }): Result<ImportDotTeaStructureCommand, DomainError> {
    return ImportDotTeaStructureCommand.createFromSource({
      baseId: input.baseId,
      source: { type: 'buffer', data: input.dotTeaData },
    });
  }

  static createFromStream(input: {
    baseId: string;
    dotTeaStream: AsyncIterable<Uint8Array>;
  }): Result<ImportDotTeaStructureCommand, DomainError> {
    return ImportDotTeaStructureCommand.createFromSource({
      baseId: input.baseId,
      source: { type: 'stream', data: input.dotTeaStream },
    });
  }

  static createFromPath(input: {
    baseId: string;
    path: string;
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
    });
  }
}
