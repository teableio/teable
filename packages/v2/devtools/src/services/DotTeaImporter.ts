import type { Effect } from 'effect';
import { Context } from 'effect';
import type { CliError } from '../errors';

export interface DotTeaImportInput {
  readonly baseId?: string;
  readonly source:
    | { type: 'path'; path: string }
    | { type: 'stream'; stream: AsyncIterable<Uint8Array> };
}

export interface DotTeaImportResult {
  readonly baseId: string;
  readonly tableCount: number;
  readonly tables: ReadonlyArray<{ id: string; name: string }>;
}

export class DotTeaImporter extends Context.Tag('DotTeaImporter')<
  DotTeaImporter,
  {
    readonly importStructure: (
      input: DotTeaImportInput
    ) => Effect.Effect<DotTeaImportResult, CliError>;
  }
>() {}
