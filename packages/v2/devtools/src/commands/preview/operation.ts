import { readFile } from 'node:fs/promises';

import { Command, Options } from '@effect/cli';
import type {
  OperationPreview,
  OperationPreviewRequest,
  PreviewMeasure,
} from '@teable/v2-command-explain';
import type { Option } from 'effect';
import { Effect } from 'effect';

import { CliError } from '../../errors';
import { CommandExplain } from '../../services';
import { connectionOption } from '../shared';

const operationOption = Options.text('operation').pipe(
  Options.withDescription('Canonical preview operation code')
);
const inputOption = Options.text('input').pipe(
  Options.withDescription('Operation input as inline JSON or a JSON file path')
);
const detailOption = Options.choice('detail', ['summary', 'full']).pipe(
  Options.withDefault('summary' as const),
  Options.withDescription('Preview detail level')
);
const includeComplexityOption = Options.boolean('include-complexity').pipe(
  Options.withDefault(false),
  Options.withDescription('Include canonical complexity analysis when supported')
);
const maxItemsOption = Options.integer('max-items').pipe(
  Options.withDefault(100),
  Options.withDescription('Maximum number of detailed preview items (1-1000)')
);
const jsonOption = Options.boolean('json').pipe(
  Options.withDefault(false),
  Options.withDescription('Print the HTTP-compatible preview DTO as JSON')
);

const invalidInput = (raw: string): CliError =>
  new CliError({
    code: 'preview.input.invalid_json_or_file',
    message: '--input must be valid inline JSON or the path to a readable JSON file',
    details: { input: raw },
  });

/** Parse the CLI's JSON-or-file input without duplicating operation-specific validation. */
export const parsePreviewInput = (raw: string): Effect.Effect<unknown, CliError> =>
  Effect.tryPromise({
    try: async () => {
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        try {
          return JSON.parse(await readFile(raw, 'utf8')) as unknown;
        } catch {
          throw invalidInput(raw);
        }
      }
    },
    catch: (error) => CliError.fromUnknown(error),
  });

export const formatPreviewMeasure = (measure: PreviewMeasure): string => {
  switch (measure.basis) {
    case 'exact':
      return `${measure.value} ${measure.unit} (exact)`;
    case 'estimate':
      return `${measure.value} ${measure.unit} (estimate; ${measure.source})`;
    case 'range':
      return `${measure.lower ?? '?'}..${measure.upper ?? '?'} ${measure.unit} (expected ${measure.expected ?? '?'}; ${measure.source})`;
    case 'unknown':
      return `unknown ${measure.unit} (${measure.reason})`;
  }
};

const formatComplexityRange = (range: {
  readonly status: string;
  readonly lower: number | null;
  readonly expected: number | null;
  readonly upper: number | null;
}): string =>
  `${range.expected ?? 'unknown'} expected [${range.lower ?? '?'}, ${range.upper ?? '?'}] (${range.status})`;

/** Human rendering keeps evidence basis and unknowns visible instead of implying safety. */
export const renderOperationPreview = (preview: OperationPreview): string => {
  const lines = [
    `Operation: ${preview.operation}`,
    `Outcome: ${preview.outcome}`,
    `Authorization: ${preview.authorization}`,
    `Consistency: ${preview.consistency}`,
  ];

  lines.push('Effects:');
  if (preview.effects.length === 0) {
    lines.push('  none reported (an empty effect list is not evidence of safety)');
  }
  for (const effect of preview.effects) {
    lines.push(`  - [${effect.code}] ${effect.kind}${effect.summary ? `: ${effect.summary}` : ''}`);
    for (const [name, measure] of Object.entries(effect.measures)) {
      lines.push(`      ${name}: ${formatPreviewMeasure(measure)}`);
    }
  }

  lines.push('Blockers:');
  if (preview.blockers.length === 0) lines.push('  none reported');
  for (const blocker of preview.blockers) {
    lines.push(`  - [${blocker.code}] ${blocker.message ?? 'No display message'}`);
  }

  lines.push('Warnings:');
  if (preview.warnings.length === 0) lines.push('  none reported');
  for (const warning of preview.warnings) {
    lines.push(`  - [${warning.code}] ${warning.message ?? 'No display message'}`);
  }

  lines.push(`Known coverage: ${preview.coverage.known.join(', ') || 'none reported'}`);
  lines.push(`Unknown coverage: ${preview.coverage.unknown.join(', ') || 'none reported'}`);

  if (preview.complexity) {
    const complexity = preview.complexity;
    lines.push('Complexity:');
    lines.push(
      `  workload ${complexity.level}; rows ${formatComplexityRange(complexity.workload.rows)}`
    );
    lines.push(
      `  confidence ${complexity.confidence}; policy ${complexity.policyVersion}; score ${complexity.score ?? 'unknown'} (sort-only)`
    );
    if (complexity.reasonCodes.length > 0) {
      lines.push(`  reason codes: ${complexity.reasonCodes.join(', ')}`);
    }
    for (const mode of complexity.breakdown.modes) {
      lines.push(`  ${mode.mode}:`);
      lines.push(`    scan: ${formatComplexityRange(mode.scan)}`);
      lines.push(`    dirty: ${formatComplexityRange(mode.dirty)}`);
      lines.push(`    estimated writes: ${formatComplexityRange(mode.estimatedWrites)}`);
    }
  } else {
    lines.push('Complexity: not requested or unavailable');
  }

  lines.push(`Observed at: ${preview.observedAt}`);
  lines.push(`Request digest: ${preview.requestDigest}`);
  return lines.join('\n');
};

/** A canonical successful response can still be unsafe to proceed from the CLI. */
export const previewOutcomeError = (preview: OperationPreview): CliError | undefined => {
  if (preview.outcome === 'ready') return undefined;
  return new CliError({
    code: `preview.outcome.${preview.outcome}`,
    message:
      preview.outcome === 'blocked'
        ? 'Operation preview is blocked; the write must not be invoked'
        : 'Operation preview is incomplete; unknown evidence requires resolution before the write',
    details: {
      operation: preview.operation,
      blockers: preview.blockers.map((blocker) => blocker.code),
      unknownCoverage: preview.coverage.unknown,
    },
  });
};

export const requireReadyPreview = (preview: OperationPreview): Effect.Effect<void, CliError> => {
  const error = previewOutcomeError(preview);
  return error ? Effect.fail(error) : Effect.succeed(undefined);
};

export const serializePreviewError = (error: CliError) => ({
  error: {
    code: error.code ?? 'preview.operation.failed',
    message: error.message,
    ...(error.details ? { details: error.details } : {}),
  },
});
const printError = (error: CliError, json: boolean): Effect.Effect<void> =>
  Effect.sync(() => {
    const payload = serializePreviewError(error);
    if (json) {
      console.error(JSON.stringify(payload));
    } else {
      console.error(`Preview failed [${payload.error.code}]: ${error.message}`);
    }
  });

const printAndFail = (error: CliError, json: boolean): Effect.Effect<never, CliError> =>
  Effect.gen(function* () {
    yield* printError(error, json);
    return yield* Effect.fail(error);
  });

const handler = (args: {
  readonly connection: Option.Option<string>;
  readonly operation: string;
  readonly input: string;
  readonly detail: 'summary' | 'full';
  readonly includeComplexity: boolean;
  readonly maxItems: number;
  readonly json: boolean;
}) =>
  Effect.gen(function* () {
    const commandExplain = yield* CommandExplain;
    const input = yield* parsePreviewInput(args.input).pipe(
      Effect.catchAll((error) => printAndFail(error, args.json))
    );
    // The CLI intentionally accepts an open string so the registry returns its stable
    // preview.operation.unsupported error instead of maintaining a second operation list.
    const request: OperationPreviewRequest = {
      operation: args.operation as OperationPreviewRequest['operation'],
      input,
      options: {
        detail: args.detail,
        includeComplexity: args.includeComplexity,
        maxItems: args.maxItems,
      },
    };

    const preview = yield* commandExplain
      .previewOperation(request)
      .pipe(Effect.catchAll((error) => printAndFail(error, args.json)));

    yield* Effect.sync(() => {
      console.log(args.json ? JSON.stringify(preview, null, 2) : renderOperationPreview(preview));
    });

    const outcomeError = previewOutcomeError(preview);
    if (outcomeError) {
      yield* printError(outcomeError, args.json);
      return yield* Effect.fail(outcomeError);
    }
  });

export const previewOperation = Command.make(
  'operation',
  {
    connection: connectionOption,
    operation: operationOption,
    input: inputOption,
    detail: detailOption,
    includeComplexity: includeComplexityOption,
    maxItems: maxItemsOption,
    json: jsonOption,
  },
  handler
).pipe(
  Command.withDescription(
    'Preview a supported write using the canonical in-process planner (non-ready outcomes exit non-zero)'
  )
);
