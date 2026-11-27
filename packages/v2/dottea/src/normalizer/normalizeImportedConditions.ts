import type { DotTeaFieldInput, DotTeaTableInput, NormalizedDotTeaField } from '@teable/v2-core';
import { textConditionOperatorSchema } from '@teable/v2-core';

type Entry = { raw: DotTeaFieldInput; fields: NormalizedDotTeaField[]; index: number };
type Predicate = { lhs: string; operator: unknown; rhs?: string; value: unknown };

function predicates(filter: unknown): Predicate[] {
  const result: Predicate[] = [];
  const pending = [filter];
  while (pending.length) {
    const node = pending.pop();
    if (!node || typeof node !== 'object') continue;
    if ('filterSet' in node && Array.isArray(node.filterSet)) {
      for (const child of node.filterSet) pending.push(child);
    } else if ('fieldId' in node && typeof node.fieldId === 'string' && 'operator' in node) {
      const value = 'value' in node ? node.value : undefined;
      const rhs =
        value &&
        typeof value === 'object' &&
        'type' in value &&
        value.type === 'field' &&
        'fieldId' in value &&
        typeof value.fieldId === 'string'
          ? value.fieldId
          : 'isSymbol' in node && node.isSymbol === true && typeof value === 'string'
            ? value
            : undefined;
      result.push({ lhs: node.fieldId, operator: node.operator, rhs, value });
    }
  }
  return result;
}

/** Revisit only consumers of a field that becomes text, including cross-table predicate operands. */
export function normalizeImportedConditions(
  tables: readonly DotTeaTableInput[],
  fieldsByTable: NormalizedDotTeaField[][]
) {
  const entries = new Map<string, Entry>();
  const subscribers = new Map<string, (() => void)[]>();
  const text = new Set<string>();
  const pending: string[] = [];
  const comparisons = new Set<() => void>();
  const subscribe = (id: string, check: () => void) => {
    const list = subscribers.get(id);
    if (list) list.push(check);
    else subscribers.set(id, [check]);
  };
  for (const [t, table] of tables.entries()) {
    for (const [index, raw] of table.fields.entries()) {
      if (!raw.id) continue;
      const fields = fieldsByTable[t];
      entries.set(raw.id, { raw, fields, index });
      if (fields[index].type === 'singleLineText') {
        text.add(raw.id);
        pending.push(raw.id);
      }
    }
  }
  const stringComparable = (id: string) => {
    if (text.has(id)) return true;
    const raw = entries.get(id)?.raw;
    return (
      raw?.cellValueType === 'string' &&
      !['link', 'user', 'createdBy', 'lastModifiedBy', 'attachment'].includes(raw.type)
    );
  };
  for (const [id, { raw, fields, index }] of entries) {
    const field = fields[index];
    const convert = () => {
      if (text.has(id)) return;
      fields[index] = {
        id,
        name: field.name,
        dbFieldName: field.dbFieldName,
        type: 'singleLineText',
        description: field.description,
        notNull: field.notNull,
        unique: field.unique,
        aiConfig: field.aiConfig,
      };
      text.add(id);
      pending.push(id);
    };
    if (field.type === 'lookup' || field.type === 'conditionalLookup') {
      const target = field.options?.lookupFieldId;
      // Multiplicity may come from the host link even when its target is ordinary text.
      if (typeof target === 'string' && raw.type !== 'singleLineText') {
        subscribe(target, convert);
      }
    }
    if (field.type !== 'conditionalLookup' && field.type !== 'conditionalRollup') continue;
    const config = field.type === 'conditionalLookup' ? field.options : field.config;
    const condition = config?.condition;
    if (!condition || typeof condition !== 'object' || !('filter' in condition)) continue;
    for (const { lhs, rhs, operator, value } of predicates(condition.filter)) {
      const compare = () => {
        if (rhs && stringComparable(lhs) !== stringComparable(rhs)) convert();
      };
      const check = () => {
        if (
          text.has(lhs) &&
          (!textConditionOperatorSchema.safeParse(operator).success ||
            (operator !== 'isEmpty' && operator !== 'isNotEmpty' && value == null))
        ) {
          convert();
        } else if (rhs) {
          comparisons.add(compare);
        }
      };
      subscribe(lhs, check);
      if (rhs) subscribe(rhs, check);
    }
  }
  // Resolve structural changes and literal predicates before comparing two field
  // references. Either side may depend on a longer lookup chain than its peer.
  for (let cursor = 0; cursor < pending.length;) {
    while (cursor < pending.length) {
      for (const check of subscribers.get(pending[cursor++]) ?? []) check();
    }
    const checks = [...comparisons];
    comparisons.clear();
    for (const check of checks) check();
  }
}
