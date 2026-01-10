import { Flags } from '@oclif/core';
import { BaseCommand } from '../base/base-command';

export default class Relations extends BaseCommand<typeof Relations> {
  static description = 'Query field dependency graph';

  static examples = [
    '<%= config.bin %> relations --field-id fld_xxx',
    '<%= config.bin %> relations --field-id fld_xxx --direction up --level 2',
    '<%= config.bin %> relations --field-id fld_xxx --direction down --same-table',
  ];

  static flags = {
    ...BaseCommand.baseFlags,
    'field-id': Flags.string({
      required: true,
      description: 'Starting field ID',
    }),
    direction: Flags.string({
      options: ['up', 'down', 'both'],
      default: 'both',
      description: 'Traversal direction: up = who depends on me, down = what I depend on',
    }),
    level: Flags.integer({
      description: 'Max traversal depth (default: unlimited)',
    }),
    'same-table': Flags.boolean({
      default: false,
      description: 'Only traverse same-table relations',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Relations);
    this.flags = flags;

    const fieldId = flags['field-id'];
    const direction = flags.direction as 'up' | 'down' | 'both';
    const level = flags.level;
    const sameTable = flags['same-table'];

    const input = {
      fieldId,
      direction,
      maxDepth: level ?? null,
      sameTableOnly: sameTable,
    };

    try {
      await this.initContainer();

      const { registerV2DebugData, v2DebugDataTokens } = await import('@teable/v2-debug-data');
      registerV2DebugData(this.container);

      const debugService = this.container.resolve(v2DebugDataTokens.debugDataService);
      const result = await debugService.getFieldRelationReport(fieldId, {
        direction,
        maxDepth: level ?? null,
        sameTableOnly: sameTable,
      });

      if (result.isErr()) {
        const errorMsg = result.error.message;
        if (errorMsg.includes('not found') || errorMsg.includes('Not found')) {
          this.printOutput(
            this.createEmptyDataOutput(
              'relations',
              input,
              `Field "${fieldId}" not found. Check if the field ID is correct and exists in the database.`
            )
          );
        } else {
          this.printOutput(this.createErrorOutput('relations', input, result.error));
        }
        this.exit(1);
      }

      this.printOutput(this.createSuccessOutput('relations', input, result.value));
    } catch (error) {
      this.printOutput(this.createErrorOutput('relations', input, error));
      this.exit(1);
    }
  }
}
