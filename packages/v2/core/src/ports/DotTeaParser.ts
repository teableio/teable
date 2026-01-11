import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';

export type DotTeaSource =
  | { type: 'buffer'; data: Uint8Array }
  | { type: 'stream'; data: AsyncIterable<Uint8Array> }
  | { type: 'path'; path: string };

export interface DotTeaFieldInput {
  readonly id?: string;
  readonly name?: string;
  readonly type: string;
  readonly isPrimary?: boolean;
  readonly isLookup?: boolean;
  readonly isConditionalLookup?: boolean;
  readonly options?: Record<string, unknown>;
  readonly lookupOptions?: Record<string, unknown>;
  readonly config?: Record<string, unknown>;
  readonly cellValueType?: string;
  readonly isMultipleCellValue?: boolean;
  readonly notNull?: boolean;
  readonly unique?: boolean;
}

export interface DotTeaViewInput {
  readonly id?: string;
  readonly name?: string;
  readonly type?: string;
}

export interface DotTeaTableInput {
  readonly id?: string;
  readonly name: string;
  readonly fields: ReadonlyArray<DotTeaFieldInput>;
  readonly views?: ReadonlyArray<DotTeaViewInput>;
}

export interface DotTeaStructure {
  readonly tables: ReadonlyArray<DotTeaTableInput>;
}

/**
 * Normalized field input after v1 conversion.
 * The type and options have been normalized to v2 format.
 */
export interface NormalizedDotTeaField {
  readonly id?: string;
  readonly type: string;
  readonly name: string;
  readonly isPrimary?: boolean;
  readonly notNull?: boolean;
  readonly unique?: boolean;
  readonly options?: Record<string, unknown>;
  readonly config?: Record<string, unknown>;
  readonly cellValueType?: string;
  readonly isMultipleCellValue?: boolean;
}

/**
 * Normalized table input after v1 conversion.
 */
export interface NormalizedDotTeaTable {
  readonly id?: string;
  readonly name: string;
  readonly fields: ReadonlyArray<NormalizedDotTeaField>;
  readonly views?: ReadonlyArray<DotTeaViewInput>;
}

/**
 * Normalized structure after v1 conversion.
 * Ready to be used with CreateTablesCommand.
 */
export interface NormalizedDotTeaStructure {
  readonly tables: ReadonlyArray<NormalizedDotTeaTable>;
}

export interface IDotTeaParser {
  /**
   * Parse raw structure from dottea file.
   * Returns the structure as-is without normalization.
   */
  parseStructure(source: DotTeaSource): Promise<Result<DotTeaStructure, DomainError>>;

  /**
   * Parse and normalize structure from dottea file.
   * Performs v1 to v2 conversion (field type normalization, options transformation).
   * Returns structure ready for CreateTablesCommand.
   */
  parseNormalizedStructure(
    source: DotTeaSource
  ): Promise<Result<NormalizedDotTeaStructure, DomainError>>;
}
