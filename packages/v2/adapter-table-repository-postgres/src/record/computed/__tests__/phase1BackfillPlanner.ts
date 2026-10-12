// Frozen benchmark baseline from 488cca0fe: numeric-only planner.
// Keep separate from production eligibility so comparisons remain reproducible.
import { FieldType, FormulaField, type Field, type Table } from '@teable/v2-core';

export const planPhase1BackfillFieldChunks = (
  table: Table,
  fields: ReadonlyArray<Field>
): Field[][] => {
  const chunks: Field[][] = [];
  let pending: Field[] = [];
  let expressionBytes = 0;
  const flush = () => {
    if (pending.length) chunks.push(pending);
    pending = [];
    expressionBytes = 0;
  };
  for (const field of fields) {
    let eligible = false;
    let length = 0;
    if (field instanceof FormulaField) {
      const expression = field.expression().toString();
      length = expression.length;
      const references = field.expression().getReferencedFieldIds();
      eligible =
        length <= 256 &&
        /^[\d\s.+*/%()^-]+$/.test(expression.replace(/\{fld[a-zA-Z0-9]+\}/g, '0')) &&
        references.isOk() &&
        references.value.every((id) => {
          const dependency = table.getFields((candidate) => candidate.id().equals(id))[0];
          return dependency?.type().equals(FieldType.number()) === true;
        });
    }
    if (!eligible) {
      flush();
      chunks.push([field]);
      continue;
    }
    if (
      pending.length >= 8 ||
      expressionBytes + length > 1024 ||
      pending.some((candidate) => candidate.id().equals(field.id()))
    ) {
      flush();
    }
    pending.push(field);
    expressionBytes += length;
  }
  flush();
  return chunks;
};
