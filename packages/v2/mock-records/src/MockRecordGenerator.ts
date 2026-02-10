import { faker as defaultFaker, type Faker } from '@faker-js/faker';
import { type Table, type TableRecord, type DomainError, domainError } from '@teable/v2-core';
import { ok, err } from 'neverthrow';
import type { Result } from 'neverthrow';
import { TableDependencyAnalyzer } from './TableDependencyAnalyzer';
import type { MockRecordOptions, MockRecordContext, MockRecordBatch } from './types';
import { FieldMockValueVisitor } from './visitors/FieldMockValueVisitor';

/**
 * Generator for creating mock records with realistic fake data.
 *
 * Features:
 * - Generates appropriate fake data for each field type
 * - Handles link field dependencies via topological sorting
 * - Supports seeded random data for reproducible tests
 * - Returns AsyncGenerator for memory-efficient batch processing
 *
 * @example
 * ```typescript
 * // Generate records for a single table
 * const generator = MockRecordGenerator.create({ count: 100, seed: 12345 });
 * for await (const batch of generator.generateForTable(table)) {
 *   await repository.insertMany(batch);
 * }
 *
 * // Generate records for related tables (handles link dependencies)
 * for await (const { tableId, records } of generator.generate([tableA, tableB])) {
 *   console.log(`Table ${tableId}: ${records.length} records`);
 * }
 * ```
 */
export class MockRecordGenerator {
  private readonly faker: Faker;
  private readonly options: Required<Omit<MockRecordOptions, 'seed' | 'faker'>> & {
    seed: number | undefined;
    faker: Faker;
  };

  private constructor(options: MockRecordOptions) {
    this.faker = options.faker ?? defaultFaker;
    this.options = {
      count: options.count,
      seed: options.seed,
      batchSize: options.batchSize ?? 100,
      faker: this.faker,
    };

    // Apply seed if provided
    if (this.options.seed !== undefined) {
      this.faker.seed(this.options.seed);
    }
  }

  /**
   * Create a new generator instance.
   *
   * @param options - Configuration options
   * @param options.count - Number of records to generate per table
   * @param options.seed - Optional seed for reproducible random data
   * @param options.batchSize - Records per batch (default: 100)
   * @param options.faker - Optional custom faker instance
   */
  static create(options: MockRecordOptions): MockRecordGenerator {
    return new MockRecordGenerator(options);
  }

  /**
   * Generate mock records for a single table.
   * Yields batches of TableRecord for memory efficiency.
   *
   * @param table - The table to generate records for
   * @param context - Optional shared context for link resolution
   * @yields Batches of generated records
   */
  async *generateForTable(
    table: Table,
    context: MockRecordContext = this.createDefaultContext()
  ): AsyncGenerator<TableRecord[], void, undefined> {
    const visitor = FieldMockValueVisitor.create();
    const editableFields = table.getEditableFields();

    // Build generators map for each field
    const fieldGenerators = new Map<string, (faker: Faker, ctx: MockRecordContext) => unknown>();

    for (const field of editableFields) {
      const generatorResult = field.accept(visitor);
      if (generatorResult.isOk()) {
        fieldGenerators.set(field.id().toString(), generatorResult.value);
      }
    }

    // Generate records in batches
    let batch: TableRecord[] = [];
    const tableId = table.id().toString();

    for (let i = 0; i < this.options.count; i++) {
      // Generate field values
      const fieldValues = new Map<string, unknown>();

      for (const [fieldId, generator] of fieldGenerators) {
        const value = generator(this.faker, context);
        if (value !== undefined) {
          fieldValues.set(fieldId, value);
        }
      }

      // Create record using Table's createRecord method
      const recordResult = table.createRecord(fieldValues);

      if (recordResult.isOk()) {
        const record = recordResult.value.record;
        batch.push(record);

        // Update context with created record ID for link resolution
        const existing = context.createdRecordIds.get(tableId) ?? [];
        context.createdRecordIds.set(tableId, [...existing, record.id().toString()]);

        // Yield batch when full
        if (batch.length >= this.options.batchSize) {
          yield batch;
          batch = [];
        }
      }
    }

    // Yield remaining records
    if (batch.length > 0) {
      yield batch;
    }
  }

  /**
   * Generate mock records for multiple related tables.
   * Automatically handles link dependencies via topological sort.
   *
   * Tables are processed in dependency order - tables that are referenced
   * by link fields are created first, so that link values can reference
   * valid record IDs.
   *
   * @param tables - Array of tables to generate records for
   * @yields MockRecordBatch containing tableId and records in dependency order
   */
  async *generate(tables: ReadonlyArray<Table>): AsyncGenerator<MockRecordBatch, void, undefined> {
    // Analyze dependencies and get creation order
    const analysisResult = TableDependencyAnalyzer.analyze(tables);

    if (analysisResult.isErr()) {
      throw new Error(`Failed to analyze table dependencies: ${analysisResult.error.message}`);
    }

    const { orderedTables, cycles } = analysisResult.value;

    // Warn about cycles (but continue - may result in null link values)
    if (cycles.length > 0) {
      console.warn(
        'Circular dependencies detected between tables:',
        cycles.map((cycle) => cycle.map((id) => id.toString()).join(' -> ')).join(', ')
      );
    }

    // Shared context for link resolution across tables
    const context: MockRecordContext = this.createDefaultContext();

    // Generate records for each table in dependency order
    for (const table of orderedTables) {
      const tableId = table.id().toString();

      for await (const batch of this.generateForTable(table, context)) {
        yield {
          tableId,
          records: batch,
        };
      }
    }
  }

  /**
   * Convenience method to generate all records and return as a Map.
   * Use generate() for streaming/memory-efficient processing of large datasets.
   *
   * @param tables - Array of tables to generate records for
   * @returns Map of tableId to array of generated records
   */
  async generateAll(
    tables: ReadonlyArray<Table>
  ): Promise<Result<Map<string, TableRecord[]>, DomainError>> {
    const result = new Map<string, TableRecord[]>();

    try {
      for await (const batch of this.generate(tables)) {
        const existing = result.get(batch.tableId) ?? [];
        result.set(batch.tableId, [...existing, ...batch.records]);
      }
      return ok(result);
    } catch (error) {
      return err(
        domainError.unexpected({
          message: error instanceof Error ? error.message : 'Unknown error during mock generation',
        })
      );
    }
  }

  /**
   * Get the faker instance used by this generator.
   * Useful for generating additional mock data outside of records.
   */
  getFaker(): Faker {
    return this.faker;
  }

  private createDefaultContext(): MockRecordContext {
    return {
      createdRecordIds: new Map(),
      faker: this.faker,
    };
  }
}
