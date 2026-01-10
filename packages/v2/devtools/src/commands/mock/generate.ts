import { Flags } from '@oclif/core';
import type { ITableRepository, ITableRecordRepository } from '@teable/v2-core';
import { MockSafeCommand } from '../../base/mock-safe-command';

export default class MockGenerate extends MockSafeCommand<typeof MockGenerate> {
  static description = 'Generate mock records for a table';

  static examples = [
    '<%= config.bin %> mock generate --table-id tbl_xxx --count 100',
    '<%= config.bin %> mock generate --table-id tbl_xxx --count 50 --seed 12345',
    '<%= config.bin %> mock generate --table-id tbl_xxx --count 10 --dry-run',
  ];

  static flags = {
    ...MockSafeCommand.baseFlags,
    'table-id': Flags.string({
      required: true,
      description: 'Table ID to generate records for',
    }),
    count: Flags.integer({
      required: true,
      description: 'Number of records to generate',
    }),
    seed: Flags.integer({
      description: 'Seed for reproducible random data',
    }),
    'batch-size': Flags.integer({
      default: 100,
      description: 'Batch size for insertion',
    }),
    'dry-run': Flags.boolean({
      default: false,
      description: "Only show what would be generated, don't insert",
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(MockGenerate);
    this.flags = flags;

    // Security check
    if (!this.validateConnection()) {
      this.exit(1);
    }

    const tableIdStr = flags['table-id'];
    const count = flags.count;
    const seed = flags.seed;
    const batchSize = flags['batch-size'];
    const dryRun = flags['dry-run'];

    if (count <= 0) {
      this.printOutput(
        this.createErrorOutput(
          'mock.generate',
          { tableId: tableIdStr },
          { message: '--count must be greater than 0' }
        )
      );
      this.exit(1);
    }

    const input = { tableId: tableIdStr, count, seed, batchSize, dryRun };

    try {
      await this.initContainer();

      const { v2CoreTokens, TableId, TableByIdSpec, ActorId } = await import('@teable/v2-core');
      const { MockRecordGenerator } = await import('@teable/v2-mock-records');

      // Parse table ID
      const tableIdResult = TableId.create(tableIdStr);
      if (tableIdResult.isErr()) {
        this.printOutput(this.createErrorOutput('mock.generate', input, tableIdResult.error));
        this.exit(1);
      }
      const tableId = tableIdResult.value;

      // Create execution context
      const actorIdResult = ActorId.create('cli-mock-records');
      if (actorIdResult.isErr()) {
        this.printOutput(this.createErrorOutput('mock.generate', input, actorIdResult.error));
        this.exit(1);
      }
      const context = {
        actorId: actorIdResult.value,
      };

      const tableRepository = this.container.resolve(
        v2CoreTokens.tableRepository
      ) as ITableRepository;
      const tableRecordRepository = this.container.resolve(
        v2CoreTokens.tableRecordRepository
      ) as ITableRecordRepository;

      // Load table
      const tableResult = await tableRepository.findOne(context, TableByIdSpec.create(tableId));
      if (tableResult.isErr()) {
        this.printOutput(this.createErrorOutput('mock.generate', input, tableResult.error));
        this.exit(1);
      }

      const table = tableResult.value;
      if (!table) {
        this.printOutput(
          this.createErrorOutput('mock.generate', input, {
            message: `Table "${tableIdStr}" not found`,
            code: 'TABLE_NOT_FOUND',
          })
        );
        this.exit(1);
      }

      // Create generator
      const generator = MockRecordGenerator.create({
        count,
        seed,
        batchSize,
      });

      // Generate records
      const sampleRecords: Array<{ id: string; fields: Record<string, unknown> }> = [];

      if (dryRun) {
        // Dry run: collect samples without inserting
        let totalGenerated = 0;
        for await (const batch of generator.generateForTable(table)) {
          totalGenerated += batch.length;
          // Collect first 5 records as sample
          for (const record of batch) {
            if (sampleRecords.length < 5) {
              const fields: Record<string, unknown> = {};
              for (const entry of record.fields().entries()) {
                fields[entry.fieldId.toString()] = entry.value.toValue();
              }
              sampleRecords.push({
                id: record.id().toString(),
                fields,
              });
            }
          }
        }

        const summary = {
          tableId: tableIdStr,
          tableName: table.name().toString(),
          totalGenerated,
          totalInserted: 0,
          dryRun: true,
          seed: seed ?? null,
          sampleRecords,
        };

        this.printOutput(this.createSuccessOutput('mock.generate', input, summary));
        return;
      }

      // Actual insert using insertManyStream
      async function* generateWithSamples() {
        for await (const batch of generator.generateForTable(table!)) {
          // Collect first 5 records as sample
          for (const record of batch) {
            if (sampleRecords.length < 5) {
              const fields: Record<string, unknown> = {};
              for (const entry of record.fields().entries()) {
                fields[entry.fieldId.toString()] = entry.value.toValue();
              }
              sampleRecords.push({
                id: record.id().toString(),
                fields,
              });
            }
          }
          yield batch;
        }
      }

      const insertResult = await tableRecordRepository.insertManyStream(
        context,
        table,
        generateWithSamples()
      );

      if (insertResult.isErr()) {
        this.printOutput(
          this.createErrorOutput('mock.generate', input, {
            message: `Failed to insert records: ${insertResult.error.message}`,
            code: 'INSERT_FAILED',
          })
        );
        this.exit(1);
      }

      const { totalInserted } = insertResult.value;

      const summary = {
        tableId: tableIdStr,
        tableName: table.name().toString(),
        totalGenerated: totalInserted,
        totalInserted,
        dryRun: false,
        seed: seed ?? null,
        sampleRecords,
      };

      this.printOutput(this.createSuccessOutput('mock.generate', input, summary));
    } catch (error) {
      this.printOutput(this.createErrorOutput('mock.generate', input, error));
      this.exit(1);
    }
  }
}
