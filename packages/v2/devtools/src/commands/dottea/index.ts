import { Command } from '@effect/cli';

import { dotteaImport } from './import';

export const dottea = Command.make('dottea').pipe(
  Command.withDescription('Import dottea structures'),
  Command.withSubcommands([dotteaImport])
);
