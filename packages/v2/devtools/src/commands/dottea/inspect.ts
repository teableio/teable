import { Command, Options } from '@effect/cli';
import type { Option } from 'effect';
import { Effect } from 'effect';
import unzipper from 'unzipper';

import { ValidationError } from '../../errors/CliError';
import { Output } from '../../services/Output';
import { optionToUndefined } from '../shared';

const pathOption = Options.text('path').pipe(
  Options.withDescription('Path to the .tea file'),
  Options.optional
);

const stdinOption = Options.boolean('stdin').pipe(
  Options.withDefault(false),
  Options.withDescription('Read .tea data from stdin')
);

type FieldReference = {
  readonly tableId?: string;
  readonly tableName: string;
  readonly fieldId?: string;
  readonly fieldName?: string;
  readonly fieldType: string;
  readonly foreignTableId: string;
  readonly source: 'options' | 'lookupOptions';
};

type MissingFieldReference = FieldReference & {
  readonly missingFieldId: string;
  readonly missingFieldRole:
    | 'lookupFieldId'
    | 'linkFieldId'
    | 'visibleFieldId'
    | 'conditionFieldId';
};

type DotTeaStructure = {
  readonly tables: ReadonlyArray<{
    readonly id?: string;
    readonly name: string;
    readonly fields: ReadonlyArray<{
      readonly id?: string;
      readonly name?: string;
      readonly type: string;
      readonly options?: Record<string, unknown>;
      readonly lookupOptions?: Record<string, unknown>;
    }>;
  }>;
};

const readString = (value: unknown, key: string): string | undefined =>
  value && typeof value === 'object' && typeof (value as Record<string, unknown>)[key] === 'string'
    ? ((value as Record<string, unknown>)[key] as string)
    : undefined;

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const collectConditionFieldIds = (value: unknown): string[] => {
  const condition = asRecord(value);
  const filter = asRecord(condition?.filter ?? value);
  const filterSet = filter?.filterSet;
  if (!Array.isArray(filterSet)) return [];
  return filterSet.flatMap((item) => {
    const record = asRecord(item);
    return typeof record?.fieldId === 'string' ? [record.fieldId] : [];
  });
};

const streamToBuffer = async (source: AsyncIterable<Uint8Array>): Promise<Buffer> => {
  const chunks: Uint8Array[] = [];
  for await (const chunk of source) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
};

const readStructure = async (
  source: { type: 'path'; path: string } | { type: 'stream'; data: AsyncIterable<Uint8Array> }
): Promise<DotTeaStructure> => {
  const zip =
    source.type === 'path'
      ? await unzipper.Open.file(source.path)
      : await unzipper.Open.buffer(await streamToBuffer(source.data));
  const entry = zip.files.find((file: unzipper.File) => file.path === 'structure.json');
  if (!entry) throw new Error('structure.json not found in dottea file');
  return JSON.parse((await entry.buffer()).toString('utf-8')) as DotTeaStructure;
};

const handler = (args: { readonly path: Option.Option<string>; readonly stdin: boolean }) =>
  Effect.gen(function* () {
    const output = yield* Output;
    const path = optionToUndefined(args.path);

    if (!args.stdin && !path) {
      return yield* Effect.fail(
        new ValidationError({ message: 'Provide --path or use --stdin', field: 'path' })
      );
    }

    if (args.stdin && path) {
      return yield* Effect.fail(
        new ValidationError({ message: 'Use either --stdin or --path, not both', field: 'stdin' })
      );
    }

    const input = args.stdin ? { stdin: true } : { path };

    const result = yield* Effect.tryPromise({
      try: async () => {
        const structure = await readStructure(
          args.stdin
            ? { type: 'stream', data: process.stdin }
            : { type: 'path', path: path as string }
        );
        const tableIds = new Set(structure.tables.flatMap((table) => (table.id ? [table.id] : [])));
        const fieldIdsByTableId = new Map(
          structure.tables.flatMap((table) =>
            table.id
              ? [[table.id, new Set(table.fields.flatMap((field) => (field.id ? [field.id] : [])))]]
              : []
          )
        );
        const references: FieldReference[] = [];
        const missingForeignFieldReferences: MissingFieldReference[] = [];

        const pushMissingField = (
          reference: FieldReference,
          tableId: string | undefined,
          fieldId: string | undefined,
          role: MissingFieldReference['missingFieldRole']
        ) => {
          if (!tableId || !fieldId) return;
          const fieldIds = fieldIdsByTableId.get(tableId);
          if (fieldIds && !fieldIds.has(fieldId)) {
            missingForeignFieldReferences.push({
              ...reference,
              missingFieldId: fieldId,
              missingFieldRole: role,
            });
          }
        };

        for (const table of structure.tables) {
          for (const field of table.fields) {
            const optionForeignTableId = readString(field.options, 'foreignTableId');
            if (optionForeignTableId) {
              const reference: FieldReference = {
                tableId: table.id,
                tableName: table.name,
                fieldId: field.id,
                fieldName: field.name,
                fieldType: field.type,
                foreignTableId: optionForeignTableId,
                source: 'options',
              };
              references.push(reference);
              pushMissingField(
                reference,
                optionForeignTableId,
                readString(field.options, 'lookupFieldId'),
                'lookupFieldId'
              );
              for (const fieldId of Array.isArray(field.options?.visibleFieldIds)
                ? field.options.visibleFieldIds
                : []) {
                pushMissingField(
                  reference,
                  optionForeignTableId,
                  typeof fieldId === 'string' ? fieldId : undefined,
                  'visibleFieldId'
                );
              }
              for (const fieldId of collectConditionFieldIds(field.options?.condition)) {
                pushMissingField(reference, optionForeignTableId, fieldId, 'conditionFieldId');
              }
            }

            const lookupForeignTableId = readString(field.lookupOptions, 'foreignTableId');
            if (lookupForeignTableId && lookupForeignTableId !== optionForeignTableId) {
              const reference: FieldReference = {
                tableId: table.id,
                tableName: table.name,
                fieldId: field.id,
                fieldName: field.name,
                fieldType: field.type,
                foreignTableId: lookupForeignTableId,
                source: 'lookupOptions',
              };
              references.push(reference);
              pushMissingField(
                reference,
                lookupForeignTableId,
                readString(field.lookupOptions, 'lookupFieldId'),
                'lookupFieldId'
              );
              pushMissingField(
                reference,
                table.id,
                readString(field.lookupOptions, 'linkFieldId'),
                'linkFieldId'
              );
            }
          }
        }

        const missingForeignReferences = references.filter(
          (reference) => !tableIds.has(reference.foreignTableId)
        );
        const missingForeignTableIds = Array.from(
          new Set(missingForeignReferences.map((reference) => reference.foreignTableId))
        );

        return {
          tableCount: structure.tables.length,
          fieldCount: structure.tables.reduce((sum, table) => sum + table.fields.length, 0),
          foreignReferenceCount: references.length,
          missingForeignTableCount: missingForeignTableIds.length,
          missingForeignTableIds,
          missingForeignReferences,
          missingForeignFieldCount: missingForeignFieldReferences.length,
          missingForeignFieldReferences,
        };
      },
      catch: (error) => error,
    }).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          yield* output.error('dottea.inspect', input, error);
          return yield* Effect.fail(error);
        })
      )
    );

    yield* output.success('dottea.inspect', input, result);
  });

export const dotteaInspect = Command.make(
  'inspect',
  {
    path: pathOption,
    stdin: stdinOption,
  },
  handler
).pipe(Command.withDescription('Inspect .tea structure references without importing'));
