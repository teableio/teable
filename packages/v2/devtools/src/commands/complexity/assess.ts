import { readFile } from 'node:fs/promises';
import { Command, Options } from '@effect/cli';
import type {
  ComplexityAssessInput,
  ComplexityAssessResult,
  ComplexitySchemaInput,
} from '@teable/v2-command-explain';
import type { OperationDescriptor, SchemaOperationKind } from '@teable/v2-complexity';
import { Effect, Option } from 'effect';
import { ValidationError } from '../../errors/CliError';
import { CommandExplain } from '../../services/CommandExplain';
import { connectionOption, tableIdOptionalOption } from '../shared';

const shapeOption = Options.text('shape').pipe(
  Options.withDescription('JSON file with { fields, edges }'),
  Options.optional
);
const operationOption = Options.text('operation').pipe(
  Options.withDescription(
    'Operation JSON, or a kind: update|create|delete|paste|field-change (with --table-id/--changed-field)'
  ),
  Options.optional
);
const changedFieldOption = Options.text('changed-field').pipe(
  Options.withDescription('Comma-separated changed field IDs for --operation <kind>'),
  Options.optional
);
const assumptionsOption = Options.text('assumptions').pipe(
  Options.withDescription('Caller assumptions JSON; plain numbers, never SQL'),
  Options.optional
);
const inputOption = Options.text('input').pipe(
  Options.withDescription('Full assessment input JSON file (cannot be combined with other inputs)'),
  Options.optional
);
const includeCatalogStatsOption = Options.boolean('include-catalog-stats').pipe(
  Options.withDefault(false),
  Options.withDescription('Read opt-in catalog aggregates for tableId (caller assumptions win)')
);
const completenessOption = Options.choice('completeness', [
  'complete',
  'partial',
  'truncated',
]).pipe(Options.optional, Options.withDescription('Caller-declared schema completeness'));
const focusTableOption = Options.text('focus-table-id').pipe(
  Options.withDescription('Focus table for the profile'),
  Options.optional
);
const maxDepthOption = Options.integer('max-traversal-depth').pipe(
  Options.withDescription('Maximum dependency traversal depth'),
  Options.optional
);
const jsonOption = Options.boolean('json').pipe(
  Options.withDefault(false),
  Options.withDescription('Print the complete { profile, assessment } JSON')
);

const parseJson = <T>(raw: string, field: string): Effect.Effect<T, ValidationError> =>
  Effect.try({
    try: () => JSON.parse(raw) as T,
    catch: () => new ValidationError({ message: `Invalid JSON in ${field}`, field }),
  });

const readJsonFile = <T>(path: string, field: string): Effect.Effect<T, ValidationError> =>
  Effect.tryPromise({
    try: async () => JSON.parse(await readFile(path, 'utf8')) as T,
    catch: () => new ValidationError({ message: `Invalid JSON file for ${field}`, field }),
  });

const operationKinds: ReadonlyArray<SchemaOperationKind> = [
  'update',
  'create',
  'delete',
  'paste',
  'field-change',
];

const isOperationKind = (value: string): value is SchemaOperationKind =>
  operationKinds.includes(value as SchemaOperationKind);

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const validateSchemaShape = (
  value: unknown
): Effect.Effect<ComplexitySchemaInput, ValidationError> =>
  Effect.gen(function* () {
    if (!isObject(value) || !Array.isArray(value.fields) || !Array.isArray(value.edges)) {
      return yield* Effect.fail(
        new ValidationError({
          message: 'Schema file must contain { fields: [], edges: [] }',
          field: 'shape',
        })
      );
    }
    return value as unknown as ComplexitySchemaInput;
  });

/**
 * Validate the public assessment input independent of transport. This keeps CLI,
 * HTTP and programmatic callers on the same source/operation invariants.
 */
export const validateComplexityAssessInput = (
  input: ComplexityAssessInput
): Effect.Effect<ComplexityAssessInput, ValidationError> =>
  Effect.gen(function* () {
    if ((input.tableId === undefined) === (input.schema === undefined)) {
      return yield* Effect.fail(
        new ValidationError({
          message: 'Provide exactly one of --table-id or --shape',
          field: 'source',
        })
      );
    }
    if (input.assumptions !== undefined && input.operation === undefined) {
      return yield* Effect.fail(
        new ValidationError({
          message: '--assumptions requires --operation',
          field: 'assumptions',
        })
      );
    }
    if (input.includeCatalogStats && input.tableId === undefined) {
      return yield* Effect.fail(
        new ValidationError({
          message: '--include-catalog-stats requires --table-id',
          field: 'include-catalog-stats',
        })
      );
    }
    return input;
  });

export const buildOperation = (
  rawOperation: string,
  tableId: string | undefined,
  changedFields: string | undefined
): Effect.Effect<OperationDescriptor, ValidationError> =>
  Effect.gen(function* () {
    if (isOperationKind(rawOperation)) {
      if (!tableId) {
        return yield* Effect.fail(
          new ValidationError({
            message: '--operation <kind> requires --table-id',
            field: 'table-id',
          })
        );
      }
      return {
        kind: rawOperation,
        tableId,
        changedFieldIds: (changedFields ?? '')
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
      };
    }

    const parsed = yield* parseJson<unknown>(rawOperation, 'operation');
    if (!isObject(parsed) || typeof parsed.kind !== 'string' || !isOperationKind(parsed.kind)) {
      return yield* Effect.fail(
        new ValidationError({
          message: '--operation JSON must contain a valid kind',
          field: 'operation',
        })
      );
    }
    return parsed as unknown as OperationDescriptor;
  });

const printJson = (result: ComplexityAssessResult): Effect.Effect<void> =>
  Effect.sync(() => {
    console.log(JSON.stringify(result, null, 2));
  });

const printHuman = (result: ComplexityAssessResult): Effect.Effect<void> =>
  Effect.sync(() => {
    const { assessment, profile } = result;
    console.log(`Complexity: ${assessment.level} (${assessment.score}/100)`);
    console.log(assessment.headline);
    console.log(
      `Components: structural ${assessment.components.structural}/100 · data-work ${
        assessment.components.dataWork === null
          ? 'not estimated'
          : `${assessment.components.dataWork}/100`
      } · risk ${assessment.components.risk}/100`
    );
    console.log(`Confidence: ${assessment.confidence} · policy ${assessment.policyVersion}`);
    if (assessment.reasonCodes.length > 0) {
      console.log(`Reason codes: ${assessment.reasonCodes.join(', ')}`);
    }
    if (assessment.recommendations.length > 0) {
      console.log('Recommendations:');
      for (const recommendation of assessment.recommendations) {
        console.log(`  - ${recommendation}`);
      }
    }
    const paths = profile.dataEstimate?.paths ?? [];
    if (paths.length > 0) {
      console.log('Path summary:');
      for (const path of paths) {
        console.log(
          `  - ${path.mode} ${path.fromFieldId} -> ${path.toFieldId} · dirty ${path.dirty.expected ?? 'unknown'} · scan ${path.scan.expected ?? 'unknown'}`
        );
      }
    }
  });

const handler = (args: {
  readonly connection: Option.Option<string>;
  readonly tableId: Option.Option<string>;
  readonly shape: Option.Option<string>;
  readonly operation: Option.Option<string>;
  readonly changedField: Option.Option<string>;
  readonly assumptions: Option.Option<string>;
  readonly input: Option.Option<string>;
  readonly includeCatalogStats: boolean;
  readonly completeness: Option.Option<'complete' | 'partial' | 'truncated'>;
  readonly focusTableId: Option.Option<string>;
  readonly maxTraversalDepth: Option.Option<number>;
  readonly json: boolean;
}) =>
  Effect.gen(function* () {
    const commandExplain = yield* CommandExplain;
    const tableId = Option.getOrUndefined(args.tableId);
    const shapePath = Option.getOrUndefined(args.shape);
    const operationRaw = Option.getOrUndefined(args.operation);
    const assumptionsRaw = Option.getOrUndefined(args.assumptions);
    const inputPath = Option.getOrUndefined(args.input);
    const changedField = Option.getOrUndefined(args.changedField);
    const focusTableId = Option.getOrUndefined(args.focusTableId);
    const maxTraversalDepth = Option.getOrUndefined(args.maxTraversalDepth);
    const completeness = Option.getOrUndefined(args.completeness);

    const input = inputPath
      ? yield* Effect.gen(function* () {
          if (
            tableId ||
            shapePath ||
            operationRaw ||
            assumptionsRaw ||
            changedField ||
            args.includeCatalogStats ||
            completeness ||
            focusTableId !== undefined ||
            maxTraversalDepth !== undefined
          ) {
            return yield* Effect.fail(
              new ValidationError({
                message: '--input cannot be combined with other input options',
                field: 'input',
              })
            );
          }
          const parsed = yield* readJsonFile<ComplexityAssessInput>(inputPath, 'input');
          return yield* validateComplexityAssessInput(parsed);
        })
      : yield* Effect.gen(function* () {
          const schema = shapePath
            ? yield* validateSchemaShape(yield* readJsonFile<unknown>(shapePath, 'shape'))
            : undefined;
          const operation = operationRaw
            ? yield* buildOperation(operationRaw, tableId, changedField)
            : undefined;
          const assumptions = assumptionsRaw
            ? yield* parseJson<ComplexityAssessInput['assumptions']>(assumptionsRaw, 'assumptions')
            : undefined;
          return yield* validateComplexityAssessInput({
            ...(tableId ? { tableId } : {}),
            ...(schema ? { schema } : {}),
            ...(operation ? { operation } : {}),
            ...(assumptions ? { assumptions } : {}),
            includeCatalogStats: args.includeCatalogStats,
            ...(completeness ? { completeness } : {}),
            ...(focusTableId ? { focusTableId } : {}),
            ...(maxTraversalDepth === undefined ? {} : { maxTraversalDepth }),
          });
        });

    const result = yield* commandExplain.assessComplexity(input).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          if (args.json) {
            yield* Effect.sync(() =>
              console.log(
                JSON.stringify(
                  { ok: false, error: { message: error.message, code: error.code } },
                  null,
                  2
                )
              )
            );
          } else {
            console.error(`Complexity assessment failed: ${error.message}`);
          }
          return yield* Effect.fail(error);
        })
      )
    );

    yield* args.json ? printJson(result) : printHuman(result);
  });

export const complexityAssess = Command.make(
  'assess',
  {
    connection: connectionOption,
    tableId: tableIdOptionalOption,
    shape: shapeOption,
    operation: operationOption,
    changedField: changedFieldOption,
    assumptions: assumptionsOption,
    input: inputOption,
    includeCatalogStats: includeCatalogStatsOption,
    completeness: completenessOption,
    focusTableId: focusTableOption,
    maxTraversalDepth: maxDepthOption,
    json: jsonOption,
  },
  handler
).pipe(Command.withDescription('Assess table complexity and return level/score/recommendations'));
