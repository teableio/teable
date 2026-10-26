import type { Effect } from 'effect';
import { Context } from 'effect';

import type { CliError } from '../errors';
import type { ReproTriggerKind } from '../repro/deadLetter';
import type { ReproFailureReport } from '../repro/failure';
import type { AppliedTrigger } from '../repro/trigger';

export type ComputedReproInput = {
  /** Source base id; required for a live export or when --task-id is used. */
  readonly baseId?: string;
  /** Optional seed table filter for trigger derivation. */
  readonly tableId?: string;
  /** Run a dead letter row from the live source data DB (read-only). */
  readonly taskId?: string;
  /** Dead-letter payload copied from the admin page, or a raw table row. */
  readonly deadLetterPath?: string;
  /** `.tea` file or raw `structure.json`. Mutually exclusive with a live export. */
  readonly structurePath?: string;
  /** Live read-only Postgres connection used for export and/or --task-id. */
  readonly connectionString?: string;
  /** JSON row sample used instead of mock rows. */
  readonly rowsPath?: string;
  /** Write a vitest skeleton here. */
  readonly emitSpecPath?: string;
  /** Artifact directory (default: ./.tmp/repro/computed-<label>). */
  readonly outDir?: string;
  /** Explicit id -> original name map path (default: <outDir>.id-map.json). */
  readonly idMapPath?: string;
  /** Mock row seed (default 1). */
  readonly seed?: number;
  /** Mock rows per table (default 5). */
  readonly rowCount?: number;
  /** Replace display names with pseudonyms (default true). */
  readonly anonymize?: boolean;
  /** Force a trigger kind instead of deriving it. */
  readonly triggerKind?: ReproTriggerKind;
  /** Force the changed field for record/link triggers. */
  readonly triggerFieldId?: string;
  /** Explicit { tableId, fieldId, field } payload for a field-update trigger. */
  readonly triggerJsonPath?: string;
  /**
   * Local fault injection, used to verify failure capture and to emulate schema
   * drift: `column-type-drift:<declaredFieldId>` rewrites that field's physical
   * column to boolean after rows are inserted, so the next computed write fails
   * with a real Postgres type error.
   */
  readonly fault?: string;
};

export type ComputedReproOutput = {
  readonly artifactDir: string;
  readonly structure: {
    readonly source: 'live' | 'file';
    readonly sanitized: boolean;
    readonly tables: number;
    readonly fields: number;
    readonly baseId?: string;
    readonly tableIdMap: Record<string, string>;
    readonly fieldIdMap: Record<string, string>;
  };
  readonly trigger: AppliedTrigger & { reason: string };
  readonly drain: { readonly processed: number; readonly iterations: number };
  readonly failure: ReproFailureReport;
  readonly files: Record<string, string>;
  readonly idMapPath?: string;
  readonly notes: string[];
};

export class ComputedRepro extends Context.Tag('ComputedRepro')<
  ComputedRepro,
  {
    readonly run: (input: ComputedReproInput) => Effect.Effect<ComputedReproOutput, CliError>;
  }
>() {}
