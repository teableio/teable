import type { Effect } from 'effect';
import { Context } from 'effect';
import type { CliError } from '../errors';

export interface MockGenerateInput {
  readonly tableId: string;
  readonly count: number;
  readonly seed?: number;
  readonly batchSize: number;
  readonly dryRun: boolean;
}

export interface MockGenerateResult {
  readonly tableId: string;
  readonly tableName: string;
  readonly totalGenerated: number;
  readonly totalInserted: number;
  readonly dryRun: boolean;
  readonly seed: number | null;
  readonly sampleRecords: Array<{ id: string; fields: Record<string, unknown> }>;
}

export class MockRecords extends Context.Tag('MockRecords')<
  MockRecords,
  {
    readonly generate: (input: MockGenerateInput) => Effect.Effect<MockGenerateResult, CliError>;
  }
>() {}
