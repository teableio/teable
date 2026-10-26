import { Layer } from 'effect';

import { ComputedReproLive } from './ComputedReproLive';
import { OutputLive } from './OutputLive';

/** Repro commands never touch the `Database` layer: the source connection is explicit. */
export const ReproLayer = Layer.mergeAll(OutputLive, ComputedReproLive);
