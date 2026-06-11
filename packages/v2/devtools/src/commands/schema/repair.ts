import { Command } from '@effect/cli';
import { schemaRepairField } from './repair-field';
import { schemaRepairRule } from './repair-rule';
import { schemaRepairTable } from './repair-table';

export const schemaRepair = Command.make('repair').pipe(
  Command.withDescription('Repair database schema using shared v2 schema rules'),
  Command.withSubcommands([schemaRepairTable, schemaRepairField, schemaRepairRule])
);
