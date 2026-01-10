import { Flags } from '@oclif/core';
import { BaseCommand } from '../../base/base-command';
import type { IExplainService } from '@teable/v2-command-explain';

export default class ExplainUpdate extends BaseCommand<typeof ExplainUpdate> {
  static description = 'Explain UpdateRecord command execution plan';

  static examples = [
    '<%= config.bin %> explain update --table-id tbl_xxx --record-id rec_xxx --fields \'{"Name":"test"}\'',
    '<%= config.bin %> explain update --table-id tbl_xxx --record-id rec_xxx --fields \'{"Name":"test"}\' --analyze',
  ];

  static flags = {
    ...BaseCommand.baseFlags,
    'table-id': Flags.string({
      required: true,
      description: 'Table ID',
    }),
    'record-id': Flags.string({
      required: true,
      description: 'Record ID',
    }),
    fields: Flags.string({
      required: true,
      description: 'JSON object of field values to update',
    }),
    analyze: Flags.boolean({
      default: false,
      description: 'Run EXPLAIN ANALYZE for actual execution stats',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ExplainUpdate);
    this.flags = flags;

    const tableId = flags['table-id'];
    const recordId = flags['record-id'];
    const fieldsJson = flags.fields;
    const analyze = flags.analyze;

    let fields: Record<string, unknown>;
    try {
      fields = JSON.parse(fieldsJson) as Record<string, unknown>;
    } catch {
      this.printOutput(
        this.createErrorOutput(
          'explain.update',
          { tableId, recordId },
          { message: 'Invalid JSON in --fields' }
        )
      );
      this.exit(1);
    }

    const input = { tableId, recordId, fields: fields!, analyze };

    try {
      await this.initContainer();

      const { registerV2DebugData } = await import('@teable/v2-debug-data');
      const { registerCommandExplainModule, v2CommandExplainTokens } = await import(
        '@teable/v2-command-explain'
      );
      const { UpdateRecordCommand, ActorId } = await import('@teable/v2-core');

      registerV2DebugData(this.container);
      registerCommandExplainModule(this.container);

      const explainService = this.resolve<IExplainService>(v2CommandExplainTokens.explainService);

      const actorIdResult = ActorId.create('cli-debug');
      if (actorIdResult.isErr()) {
        this.printOutput(this.createErrorOutput('explain.update', input, actorIdResult.error));
        this.exit(1);
      }

      const context = {
        actorId: actorIdResult.value,
      };

      const commandResult = UpdateRecordCommand.create({ tableId, recordId, fields: fields! });
      if (commandResult.isErr()) {
        this.printOutput(this.createErrorOutput('explain.update', input, commandResult.error));
        this.exit(1);
      }

      const result = await explainService.explain(context, commandResult.value, {
        analyze,
        includeSql: true,
        includeGraph: false,
        includeLocks: true,
      });

      if (result.isErr()) {
        this.printOutput(this.createErrorOutput('explain.update', input, result.error));
        this.exit(1);
      }

      this.printOutput(this.createSuccessOutput('explain.update', input, result.value));
    } catch (error) {
      this.printOutput(this.createErrorOutput('explain.update', input, error));
      this.exit(1);
    }
  }
}
