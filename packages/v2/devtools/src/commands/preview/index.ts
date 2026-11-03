import { Command } from '@effect/cli';

import { previewCapabilities } from './capabilities';
import { previewOperation } from './operation';

export const preview = Command.make('preview').pipe(
  Command.withDescription('Discover and run canonical operation previews'),
  Command.withSubcommands([previewOperation, previewCapabilities])
);

export { previewCapabilities, previewOperation };
