import { Flags } from '@oclif/core';
import { BaseCommand } from '../../base/base-command';
import type { IExplainService } from '@teable/v2-command-explain';

export default class ExplainDelete extends BaseCommand<typeof ExplainDelete> {
  static description = 'Explain DeleteRecords command execution plan';

  static examples = [
    '<%= config.bin %> explain delete --table-id tbl_xxx --record-ids rec_xxx',
    '<%= config.bin %> explain delete --table-id tbl_xxx --record-ids rec_xxx,rec_yyy --analyze',
  ];

  static flags = {
    ...BaseCommand.baseFlags,
    'table-id': Flags.string({
      required: true,
      description: 'Table ID',
    }),
    'record-ids': Flags.string({
      required: true,
      description: 'Comma-separated record IDs',
    }),
    analyze: Flags.boolean({
      default: false,
      description: 'Run EXPLAIN ANALYZE for actual execution stats',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ExplainDelete);
    this.flags = flags;

    const tableId = flags['table-id'];
    const recordIdsStr = flags['record-ids'];
    const analyze = flags.analyze;

    const recordIds = recordIdsStr.split(',').map((id) => id.trim());
    const input = { tableId, recordIds, analyze };

    try {
      await this.initContainer();

      const { registerV2DebugData } = await import('@teable/v2-debug-data');
      const { registerCommandExplainModule, v2CommandExplainTokens } = await import(
        '@teable/v2-command-explain'
      );
      const { DeleteRecordsCommand, RecordId, ActorId } = await import('@teable/v2-core');

      // Validate record IDs
      for (const id of recordIds) {
        const recordIdResult = RecordId.create(id);
        if (recordIdResult.isErr()) {
          this.printOutput(
            this.createErrorOutput('explain.delete', input, { message: `Invalid record ID: ${id}` })
          );
          this.exit(1);
        }
      }

      registerV2DebugData(this.container);
      registerCommandExplainModule(this.container);

      const explainService = this.resolve<IExplainService>(v2CommandExplainTokens.explainService);

      const actorIdResult = ActorId.create('cli-debug');
      if (actorIdResult.isErr()) {
        this.printOutput(this.createErrorOutput('explain.delete', input, actorIdResult.error));
        this.exit(1);
      }

      const context = {
        actorId: actorIdResult.value,
      };

      const commandResult = DeleteRecordsCommand.create({ tableId, recordIds });
      if (commandResult.isErr()) {
        this.printOutput(this.createErrorOutput('explain.delete', input, commandResult.error));
        this.exit(1);
      }

      const result = await explainService.explain(context, commandResult.value, {
        analyze,
        includeSql: true,
        includeGraph: false,
        includeLocks: true,
      });

      if (result.isErr()) {
        this.printOutput(this.createErrorOutput('explain.delete', input, result.error));
        this.exit(1);
      }

      this.printOutput(this.createSuccessOutput('explain.delete', input, result.value));
    } catch (error) {
      this.printOutput(this.createErrorOutput('explain.delete', input, error));
      this.exit(1);
    }
  }
}
