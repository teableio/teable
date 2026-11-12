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
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key, child]) => !Object.hasOwn(physicalKeys, key) && child !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left === right ? 0 : 1))
        .map(([key, child]) => [key, canonical(child)])
    );
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

/** Fingerprints the used logical field contracts, not unrelated metadata or stored values. */
export const dataQuerySchemaSignature = async (
  plan: BoundDataQueryPlan,
  tables: ReadonlyMap<string, ITableReadModel>,
  outputs: ReadonlyArray<DataQueryOutput>
): Promise<Result<string, DomainError>> => {
  const contract = safeTry(function* () {
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
      canonical({
        version: 1,
        ...(plan.definitionVersion === 3
          ? {
              definitionVersion: plan.definitionVersion,
              formulaLanguage: plan.formulaLanguage,
            }
          : {}),
        fields,
        outputs,
      })
    );
  });
  if (contract.isErr()) return err(contract.error);
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(contract.value))
  );
  return ok(
    `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
  );
};
