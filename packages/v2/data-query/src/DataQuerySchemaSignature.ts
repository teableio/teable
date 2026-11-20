import { types as nodeTypes } from 'node:util';

import {
  ConditionalLookupField,
  isConditionalRollupField,
  FieldOptionsDtoVisitor,
  FieldValueTypeVisitor,
  LookupField,
  RollupField,
  type DomainError,
  type Field,
  type ITableReadModel,
} from '@teable/v2-core';
import { err, ok, safeTry, type Result } from 'neverthrow';

import type { BoundDataQueryPlan } from './BoundDataQueryPlan';
import type { DataQueryOutput } from './types';

// Physical placement is deliberately absent; a tenant move must not invalidate a logical contract.
const physicalKeys: Readonly<Record<string, true>> = {
  dbFieldName: true,
  dbTableName: true,
  fkHostTableName: true,
  selfKeyName: true,
  foreignKeyName: true,
  orderColumnName: true,
  dbForeignTableName: true,
};
type CursorSchemaState = { contract: unknown; isCanonical: boolean };

// Array.map passes an index as its second argument, never cursor detection state.
const canonicalEntry = (value: unknown): unknown => canonical(value);
const canonical = (value: unknown, cursorState?: CursorSchemaState): unknown => {
  if (Array.isArray(value)) {
    if (!cursorState) return value.map(canonicalEntry);
    // A custom map/species may produce state that needs the cursor's prototype handling.
    let ordinaryArray = false;
    try {
      ordinaryArray =
        !nodeTypes.isProxy(value) &&
        Object.getPrototypeOf(value) === Array.prototype &&
        !Object.hasOwn(value, 'constructor') &&
        !Object.hasOwn(value, 'map');
    } catch {
      // Recognition is optional; proxy inspection must not reject otherwise bindable state.
    }
    if (!ordinaryArray) {
      cursorState.isCanonical = false;
      return value.map(canonicalEntry);
    }
    return value.map((entry) => canonical(entry, cursorState));
  }
  if (value !== null && typeof value === 'object') {
    const state: Record<string, unknown> = {};
    const entries = Object.entries(value)
      .filter(([key, child]) => !Object.hasOwn(physicalKeys, key) && child !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left === right ? 0 : 1));
    for (const [key, child] of entries) {
      const result = canonical(child, cursorState);
      if (key === '__proto__') {
        Object.defineProperty(state, key, {
          value: result,
          enumerable: true,
          configurable: true,
          writable: true,
        });
      } else {
        state[key] = result;
      }
    }
    return state;
  }
  if (
    cursorState &&
    value !== null &&
    typeof value !== 'string' &&
    typeof value !== 'boolean' &&
    !(typeof value === 'number' && Number.isFinite(value))
  ) {
    cursorState.isCanonical = false;
  }
  return value;
};

const logicalFieldContract = (field: Field): Result<Record<string, unknown>, DomainError> =>
  safeTry(function* () {
    const valueType = yield* field.accept(new FieldValueTypeVisitor());
    const options = yield* field.accept(new FieldOptionsDtoVisitor());
    const config =
      field instanceof LookupField
        ? field.lookupOptionsDto()
        : field instanceof RollupField || isConditionalRollupField(field)
          ? field.configDto()
          : undefined;
    const inner =
      field instanceof LookupField || field instanceof ConditionalLookupField
        ? yield* logicalFieldContract(yield* field.innerField())
        : undefined;
    return ok({
      type: field.type().toString(),
      cellValueType: valueType.cellValueType.toString(),
      isMultipleCellValue: valueType.isMultipleCellValue.toBoolean(),
      nullable: !field.notNull().toBoolean(),
      options,
      config,
      inner,
    });
  });

const logicalSchemaContract = (
  plan: BoundDataQueryPlan,
  tables: ReadonlyMap<string, ITableReadModel>,
  outputs: ReadonlyArray<DataQueryOutput>,
  cursorState?: CursorSchemaState
): Result<unknown, DomainError> =>
  safeTry(function* () {
    const fields: unknown[] = [];
    const usages = [...plan.usage].sort((left, right) =>
      left.source === right.source
        ? left.fieldId.localeCompare(right.fieldId)
        : left.source.localeCompare(right.source)
    );
    for (const usage of usages) {
      const table = tables.get(usage.source)!;
      const field = yield* table.getField((item) => item.id().toString() === usage.fieldId);
      const semantics = yield* logicalFieldContract(field);
      fields.push({
        source: usage.source,
        tableId: table.id().toString(),
        fieldId: usage.fieldId,
        ...semantics,
      });
    }
    return ok(
      canonical(
        {
          version: 1,
          ...(plan.definitionVersion >= 3
            ? {
                definitionVersion: plan.definitionVersion,
                formulaLanguage: plan.formulaLanguage,
              }
            : {}),
          ...(plan.definitionVersion >= 6 ? { resultGrain: plan.resultGrain } : {}),
          ...(plan.definitionVersion === 9 ? { topN: plan.topN } : {}),
          ...(plan.definitionVersion === 8
            ? {
                distinctAggregates: plan.aggregates
                  .filter((metric) => metric.distinctExpressions)
                  .map((metric) => ({
                    alias: metric.alias,
                    source: metric.source,
                    keys: metric.distinctExpressions!.map((key) => ({
                      formula: key.formula,
                      recordSource: key.recordSource,
                      timeZone: key.timeZone,
                      references: Object.fromEntries(
                        Object.entries(key.references).map(([alias, reference]) => [
                          alias,
                          reference.kind === 'field'
                            ? {
                                kind: reference.kind,
                                source: reference.source,
                                fieldId: reference.fieldId,
                              }
                            : reference.kind === 'system'
                              ? {
                                  kind: reference.kind,
                                  source: reference.source,
                                  system: reference.system,
                                }
                              : { kind: reference.kind, name: reference.name },
                        ])
                      ),
                    })),
                  })),
              }
            : {}),
          fields,
          outputs,
        },
        cursorState
      )
    );
  });

/** Logical schema state shared by schema diagnostics and cursor invalidation. */
export const dataQueryLogicalSchemaContract = (
  plan: BoundDataQueryPlan,
  tables: ReadonlyMap<string, ITableReadModel>,
  outputs: ReadonlyArray<DataQueryOutput>
): Result<unknown, DomainError> => logicalSchemaContract(plan, tables, outputs);

/** Recognizes cursor-safe JSON while building the schema, without another traversal. */
export const dataQueryCursorSchemaContract = (
  plan: BoundDataQueryPlan,
  tables: ReadonlyMap<string, ITableReadModel>
): Result<{ contract: unknown; isCanonical: boolean }, DomainError> => {
  const state: CursorSchemaState = { contract: undefined, isCanonical: true };
  return logicalSchemaContract(plan, tables, [], state).map((contract) => {
    state.contract = contract;
    return state;
  });
};

/** Fingerprints the used logical field contracts, not unrelated metadata or stored values. */
export const dataQuerySchemaSignature = async (
  plan: BoundDataQueryPlan,
  tables: ReadonlyMap<string, ITableReadModel>,
  outputs: ReadonlyArray<DataQueryOutput>
): Promise<Result<string, DomainError>> => {
  const contract = dataQueryLogicalSchemaContract(plan, tables, outputs);
  if (contract.isErr()) return err(contract.error);
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(contract.value))
  );
  return ok(
    `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
  );
};
