import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { TemporaryPasteSourceField } from '../../commands/TemporaryPasteCommand';
import { domainError, type DomainError } from '../../domain/shared/DomainError';
import { isoDateTimeWithOffsetSchema } from '../../domain/shared/isoDateTimeSchema';
import type { Field } from '../../domain/table/fields/Field';
import { DateField } from '../../domain/table/fields/types/DateField';
import { LinkField } from '../../domain/table/fields/types/LinkField';
import { UserField } from '../../domain/table/fields/types/UserField';
import { parseDateValue } from '../../domain/table/fields/visitors/dateValueParser';
import { FieldValueTypeVisitor } from '../../domain/table/fields/visitors/FieldValueTypeVisitor';
import { DefaultTableMapper } from '../../ports/mappers/defaults/DefaultTableMapper';
import type { ITableFieldPersistenceDTO } from '../../ports/mappers/TableMapper';
import {
  conditionalRollupConfigSchema,
  rollupConfigSchema,
  tableFieldInputSchema,
} from '../../schemas/field';
import { FieldClipboardValueVisitor } from '../formatting/FieldClipboardValueVisitor';

const absoluteDateTimeSchema = isoDateTimeWithOffsetSchema();

export type TemporaryPasteSource = {
  readonly field: Field;
  readonly multiple: boolean;
  readonly dateTime: boolean;
  readonly forceLinkTitles: boolean;
};

/** Hydrate the value-owning inner field; source relations are not destination relations. */
export const prepareTemporaryPasteSource = (
  target: Field,
  header: TemporaryPasteSourceField
): Result<TemporaryPasteSource, DomainError> => {
  const type =
    header.type === 'rollup' && header.isConditionalLookup ? 'conditionalRollup' : header.type;
  let config = header.config ?? header.lookupOptions;
  if (type === 'rollup' || type === 'conditionalRollup') {
    const parsedConfig = (
      type === 'rollup' ? rollupConfigSchema.strip() : conditionalRollupConfigSchema.strip()
    ).safeParse(config);
    if (!parsedConfig.success) {
      return err(
        domainError.validation({ message: 'Invalid temporary paste source rollup configuration' })
      );
    }
    config = parsedConfig.data;
  }
  const parsed = tableFieldInputSchema.safeParse({
    id: header.id ?? target.id().toString(),
    name: header.name ?? target.name().toString(),
    type,
    options: header.options,
    ...(type === 'rollup' || type === 'conditionalRollup' ? { config } : {}),
  });
  if (!parsed.success) {
    return err(
      domainError.validation({ message: 'Invalid temporary paste source field metadata' })
    );
  }
  // Deliberately hydrate the value-owning inner type, not a LookupField: the clipboard
  // snapshot already supplies its result metadata and outer multiplicity. Forwarding
  // isLookup/isConditionalLookup would require its original relation and can create a
  // pending inner field. isComputed follows the native inner type; it is not a target
  // write restriction. Keep result type, multiplicity, formatting and meta below.
  const dto = {
    ...parsed.data,
    id: header.id ?? target.id().toString(),
    name: header.name ?? target.name().toString(),
    cellValueType: header.cellValueType,
    isMultipleCellValue: header.isMultipleCellValue,
    meta: header.meta,
  } as ITableFieldPersistenceDTO;
  return new DefaultTableMapper().fieldFromDTO(dto).andThen((field) =>
    field.accept(new FieldValueTypeVisitor()).map((valueType) => ({
      field,
      multiple: header.isMultipleCellValue ?? valueType.isMultipleCellValue.isMultiple(),
      dateTime: valueType.cellValueType.toString() === 'dateTime',
      forceLinkTitles:
        target instanceof LinkField &&
        (!(field instanceof LinkField) || !field.foreignTableId().equals(target.foreignTableId())),
    }))
  );
};

export const convertTemporaryPasteCellValue = (
  target: Field,
  source: TemporaryPasteSource,
  value: unknown
): Result<unknown, DomainError> => {
  if (value == null) return ok(null);
  const sourceType = source.field.type().toString();
  const targetType = target.type().toString();

  if ((targetType === 'user' || targetType === 'attachment') && sourceType === targetType) {
    // Clipboard lookup cells may add one array level. Destination visitors own cardinality.
    const items = Array.isArray(value) ? value.flat() : [value];
    return ok(
      target instanceof UserField && !target.multiplicity().toBoolean() ? (items[0] ?? null) : items
    );
  }
  if (target instanceof DateField && source.field instanceof DateField) {
    if (Array.isArray(value)) return ok(value.flat()[0] ?? null);
    if (typeof value === 'string' && source.multiple) {
      let candidate = '';
      for (const segment of value.split(',')) {
        candidate = candidate ? `${candidate}, ${segment.trim()}` : segment.trim();
        const parsed = parseDateValue(source.field, candidate);
        if (parsed !== undefined && parsed !== null) return ok(parsed);
      }
    }
    return ok(value);
  }
  if (
    (targetType === 'singleSelect' || targetType === 'multipleSelect') &&
    (sourceType === 'singleSelect' || sourceType === 'multipleSelect')
  ) {
    if (!Array.isArray(value)) return ok(value);
    const items = value.flat();
    return ok(targetType === 'multipleSelect' ? items : (items[0] ?? null));
  }
  if (target instanceof LinkField && source.field instanceof LinkField) {
    if (typeof value === 'string') return ok(value);
    const items = Array.isArray(value) ? value.flat() : [value];
    if (source.forceLinkTitles) {
      return ok(
        items
          .map((item) => {
            if (typeof item === 'object' && item !== null) {
              return 'title' in item ? String(item.title ?? '') : '';
            }
            return String(item);
          })
          .filter(Boolean)
      );
    }
    return ok(items);
  }
  // Typed datetimes have an absolute ISO offset. Rendered clipboard strings
  // must stay verbatim: interpreting their wall clock in the server timezone
  // and converting it again shifts the display time.
  if (
    typeof value === 'string' &&
    (!source.dateTime || !value.includes('T') || !absoluteDateTimeSchema.safeParse(value).success)
  ) {
    return ok(value);
  }
  return source.field.accept(new FieldClipboardValueVisitor(value, source.multiple));
};
