import { Command } from '@effect/cli';

import { dotteaInspect } from './inspect';
import { dotteaImport } from './import';

export const dottea = Command.make('dottea').pipe(
  Command.withDescription('Import dottea structures'),
  Command.withSubcommands([dotteaImport, dotteaInspect])
);
