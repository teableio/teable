import type { Faker } from '@faker-js/faker';
import type { TableRecord } from '@teable/v2-core';

/**
 * Options for mock record generation
 */
export type MockRecordOptions = {
  /** Number of records to generate per table */
  count: number;
  /** Seed for reproducible random data (optional, for testing) */
  seed?: number;
  /** Batch size for yielding records (default: 100) */
  batchSize?: number;
  /** Custom faker instance (optional) */
  faker?: Faker;
};

/**
 * Context shared during mock record generation
 */
export type MockRecordContext = {
  /** Map of tableId -> created record IDs for link resolution */
  createdRecordIds: Map<string, string[]>;
  /** The faker instance to use */
  faker: Faker;
};

/**
 * A batch of generated mock records for a single table
 */
export type MockRecordBatch = {
  tableId: string;
  records: TableRecord[];
};

/**
 * Function type for generating mock values
 */
export type MockValueGenerator = (faker: Faker, context: MockRecordContext) => unknown;
