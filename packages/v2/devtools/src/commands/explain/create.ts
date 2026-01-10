import { Flags } from '@oclif/core';
import { BaseCommand } from '../../base/base-command';
import type { IExplainService } from '@teable/v2-command-explain';

export default class ExplainCreate extends BaseCommand<typeof ExplainCreate> {
  static description = 'Explain CreateRecord command execution plan';

  static examples = [
    '<%= config.bin %> explain create --table-id tbl_xxx',
    '<%= config.bin %> explain create --table-id tbl_xxx --fields \'{"Name":"test"}\'',
    '<%= config.bin %> explain create --table-id tbl_xxx --analyze',
  ];

  static flags = {
    ...BaseCommand.baseFlags,
    'table-id': Flags.string({
      required: true,
      description: 'Table ID',
    }),
    fields: Flags.string({
      description: 'JSON object of field values (default: {})',
    }),
    analyze: Flags.boolean({
      default: false,
      description: 'Run EXPLAIN ANALYZE for actual execution stats',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ExplainCreate);
    this.flags = flags;

    const tableId = flags['table-id'];
    const fieldsJson = flags.fields;
    const analyze = flags.analyze;

    let fields: Record<string, unknown> = {};
    if (fieldsJson) {
      try {
        fields = JSON.parse(fieldsJson) as Record<string, unknown>;
      } catch {
        this.printOutput(
          this.createErrorOutput(
            'explain.create',
            { tableId },
            { message: 'Invalid JSON in --fields' }
          )
        );
        this.exit(1);
      }
    }

    const input = { tableId, fields, analyze };

    try {
      await this.initContainer();

      const { registerV2DebugData } = await import('@teable/v2-debug-data');
      const { registerCommandExplainModule, v2CommandExplainTokens } = await import(
        '@teable/v2-command-explain'
      );
      const { CreateRecordCommand, ActorId } = await import('@teable/v2-core');

      registerV2DebugData(this.container);
      registerCommandExplainModule(this.container);

      const explainService = this.resolve<IExplainService>(v2CommandExplainTokens.explainService);

      const actorIdResult = ActorId.create('cli-debug');
      if (actorIdResult.isErr()) {
        this.printOutput(this.createErrorOutput('explain.create', input, actorIdResult.error));
        this.exit(1);
      }

      const context = {
        actorId: actorIdResult.value,
      };

      const commandResult = CreateRecordCommand.create({ tableId, fields });
      if (commandResult.isErr()) {
        this.printOutput(this.createErrorOutput('explain.create', input, commandResult.error));
        this.exit(1);
      }

      const result = await explainService.explain(context, commandResult.value, {
        analyze,
        includeSql: true,
        includeGraph: false,
        includeLocks: true,
      });

      if (result.isErr()) {
        this.printOutput(this.createErrorOutput('explain.create', input, result.error));
        this.exit(1);
      }

      this.printOutput(this.createSuccessOutput('explain.create', input, result.value));
    } catch (error) {
      this.printOutput(this.createErrorOutput('explain.create', input, error));
      this.exit(1);
    }
  }
}
