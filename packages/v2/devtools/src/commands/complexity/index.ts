import { Command } from '@effect/cli';

import { complexityAssess } from './assess';

export const complexity = Command.make('complexity').pipe(
  Command.withDescription('Assess table or raw-schema complexity'),
  Command.withSubcommands([complexityAssess])
);

export { complexityAssess } from './assess';
