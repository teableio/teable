import { FieldType } from '@teable/v2-core';

import { isStoredVcsField } from '../../domain/fieldClassification';
import type { IBaseVcsSnapshot, IFieldVcsSnapshot } from '../../domain/types';

/** Materialize only the checkpoint's authorized values. The persisted schema remains historical. */
export function historicalEngineSnapshot(snapshot: IBaseVcsSnapshot): IBaseVcsSnapshot {
  return {
    ...snapshot,
    tables: snapshot.tables.map((table) => {
      const textFields = new Set<string>();
      const fields = table.fields.map((field): IFieldVcsSnapshot => {
        // A cell grant carries its type, but can withhold the range or multiplicity.
        // Use a numeric column for ratings so the engine can sort the frozen values.
        if (
          field.type === 'rating' &&
          field.options?.max === undefined &&
          isStoredVcsField(field)
        ) {
          return {
            id: field.id,
            name: field.name,
            type: 'number',
            isPrimary: field.isPrimary,
            isComputed: false,
          };
        }
        const unsupportedPrimary =
          field.isPrimary &&
          !FieldType.create(field.type)
            .map((type) => type.isPrimarySupported())
            .unwrapOr(false);
        // Executing formulas, defaults or links can fill an intentionally absent cell or
        // derive a title from a different primary field. These columns hold frozen values.
        const missingChoices =
          (field.type === 'singleSelect' || field.type === 'multipleSelect') &&
          !field.options?.choices;
        if (
          field.type === 'link' ||
          field.type === 'button' ||
          missingChoices ||
          (field.type === 'user' && field.options?.isMultiple === undefined) ||
          unsupportedPrimary ||
          !isStoredVcsField(field)
        ) {
          textFields.add(field.id);
          return {
            id: field.id,
            name: field.name,
            type: field.isPrimary ? 'singleLineText' : 'longText',
            isPrimary: field.isPrimary,
            isComputed: false,
          };
        }
        const options = { ...field.options };
        delete options.defaultValue;
        return { ...field, options, unique: false, notNull: false, aiConfig: undefined };
      });
      return {
        ...table,
        fields,
        records: table.records.map((record) => {
          let cells: Record<string, unknown> | undefined;
          for (const [id, value] of Object.entries(record.fields)) {
            if (!textFields.has(id) || value == null || typeof value === 'string') continue;
            cells ??= { ...record.fields };
            cells[id] = JSON.stringify(value);
          }
          return cells ? { ...record, fields: cells } : record;
        }),
      };
    }),
  };
}
