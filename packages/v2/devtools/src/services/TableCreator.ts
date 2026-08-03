import type { Effect } from 'effect';
import { Context } from 'effect';
import type { CliError } from '../errors';

/** Input for creating a single table */
export interface CreateTableInput {
  readonly baseId: string;
  readonly tableId?: string;
  readonly name: string;
  readonly fields?: ReadonlyArray<{
    readonly type: string;
    readonly name: string;
    readonly isPrimary?: boolean;
    readonly options?: Record<string, unknown>;
  }>;
  readonly views?: ReadonlyArray<{
    readonly type?: 'grid' | 'calendar' | 'kanban' | 'form' | 'gallery' | 'plugin';
    readonly name?: string;
  }>;
}

/** Result of table creation */
export interface CreateTableResult {
  readonly tableId: string;
  readonly tableName: string;
  readonly fieldCount: number;
  readonly viewCount: number;
}

export class TableCreator extends Context.Tag('TableCreator')<
  TableCreator,
  {
    /** Create a single table (without records) */
    readonly createTable: (input: CreateTableInput) => Effect.Effect<CreateTableResult, CliError>;
  }
>() {}
