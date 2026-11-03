import type { PreviewCapability } from '@teable/v2-command-explain';
import type { Effect } from 'effect';
import { Context } from 'effect';

export class PreviewCapabilities extends Context.Tag('PreviewCapabilities')<
  PreviewCapabilities,
  {
    readonly list: () => Effect.Effect<ReadonlyArray<PreviewCapability>>;
  }
>() {}
