import {
  attachmentCellValueSchema,
  FieldType,
  NumberFormattingType,
  type INumberFieldOptions,
} from '@teable/core';
import type { IFieldInstance } from '@teable/sdk/model';

/**
 * URL query params that can prefill a form body: router.query carries route
 * params (shareId, embed, ...) alongside the field-id keys, so only keys that
 * match a visible field are read.
 */
export type FormPrefillQuery = Record<string, string | string[] | undefined>;
type PrefillQueryValue = string | string[] | undefined;

const FLOAT_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const PERCENT_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)%$/;
const TRUE_VALUES: Record<string, true> = { true: true, '1': true, yes: true, on: true };
const readQueryValue = (value: PrefillQueryValue) => {
  if (Array.isArray(value)) {
    const values = value.filter((item) => item !== '');
    return values.length ? values[0] : undefined;
  }
  return value === undefined || value === '' ? undefined : value;
};

const parseNumberValue = (field: IFieldInstance, raw: string) => {
  const trimmed = raw.trim();
  // Only a plain decimal (optionally suffixed with %) is a valid URL value:
  // whitespace, radix prefixes and trailing junk are rejected instead of
  // letting Number() coerce them into a different cell value.
  if (!FLOAT_PATTERN.test(trimmed) && !PERCENT_PATTERN.test(trimmed)) return undefined;

  const value = Number(trimmed.replace(/%$/, ''));
  if (!Number.isFinite(value)) return undefined;

  // Match the number editor: percent input like `42` or `42%` means 42%.
  const formatting = (field.options as INumberFieldOptions | undefined)?.formatting;
  const isPercent = trimmed.endsWith('%') || formatting?.type === NumberFormattingType.Percent;
  return isPercent ? value / 100 : value;
};

const parseStructuredValue = (field: IFieldInstance, raw: string) => {
  try {
    const repaired = field.repair(JSON.parse(raw));
    if (Array.isArray(repaired) && !repaired.length) return undefined;
    return repaired ?? undefined;
  } catch {
    return undefined;
  }
};

const convertStringValue = (field: IFieldInstance, queryValue: PrefillQueryValue) => {
  const raw = readQueryValue(queryValue);
  if (raw === undefined) return undefined;
  const converted = field.convertStringToCellValue(raw);
  return converted ?? undefined;
};

const parseCheckboxValue = (queryValue: PrefillQueryValue) => {
  // An unchecked box is an empty cell, so only a true-ish value prefills.
  const raw = readQueryValue(queryValue);
  if (raw === undefined) return undefined;
  return TRUE_VALUES[raw.trim().toLowerCase()] === true ? true : undefined;
};

const parseMultipleSelectValue = (field: IFieldInstance, queryValue: PrefillQueryValue) => {
  const values = Array.isArray(queryValue) ? queryValue.filter((item) => item !== '') : undefined;
  // A repeated param is one option each; quote an option that itself contains a
  // comma so the field's CSV splitter keeps it whole.
  const raw = values
    ? values
        .map((item) =>
          item.includes(',') && !(item.startsWith('"') && item.endsWith('"')) ? `"${item}"` : item
        )
        .join(',')
    : readQueryValue(queryValue);
  if (!raw) return undefined;
  const converted = field.convertStringToCellValue(raw);
  return Array.isArray(converted) && converted.length ? converted : undefined;
};

const parseRatingValue = (field: IFieldInstance, queryValue: PrefillQueryValue) => {
  const raw = readQueryValue(queryValue);
  if (raw === undefined || !FLOAT_PATTERN.test(raw.trim())) return undefined;
  const converted = field.convertStringToCellValue(raw.trim());
  // A rating cell is an integer from 1 to the field maximum; 0 or a negative
  // value renders as an empty rating but still passes form validation.
  return typeof converted === 'number' && converted >= 1 ? converted : undefined;
};

const parseStructuredFieldValue = (field: IFieldInstance, queryValue: PrefillQueryValue) => {
  const raw = readQueryValue(queryValue);
  return raw === undefined ? undefined : parseStructuredValue(field, raw);
};

const parseAttachmentValue = (field: IFieldInstance, queryValue: PrefillQueryValue) => {
  const value = parseStructuredFieldValue(field, queryValue);
  // The attachment editor renders preview/download from the full item and keys
  // delete/rename by id; a submission-only {name, token} item is not editable.
  const parsed = attachmentCellValueSchema.safeParse(value);
  return parsed.success && parsed.data.length ? parsed.data : undefined;
};

const parsePrefillValue = (field: IFieldInstance, queryValue: PrefillQueryValue): unknown => {
  switch (field.type) {
    case FieldType.SingleLineText:
    case FieldType.LongText:
      return readQueryValue(queryValue);

    case FieldType.Number: {
      const raw = readQueryValue(queryValue);
      return raw === undefined ? undefined : parseNumberValue(field, raw);
    }

    case FieldType.Checkbox:
      return parseCheckboxValue(queryValue);

    case FieldType.SingleSelect:
    case FieldType.Date:
      return convertStringValue(field, queryValue);

    case FieldType.MultipleSelect:
      return parseMultipleSelectValue(field, queryValue);

    case FieldType.Rating:
      return parseRatingValue(field, queryValue);

    // Structured cells carry objects, so their URL value is a JSON document and
    // the field's own validator decides whether it is a usable cell value.
    case FieldType.User:
    case FieldType.Link:
      return parseStructuredFieldValue(field, queryValue);

    case FieldType.Attachment:
      return parseAttachmentValue(field, queryValue);

    // Button and computed/system fields have no editable cell value.
    default:
      return undefined;
  }
};

/**
 * Resolves the URL-prefill values for the fields a form currently renders.
 * Unknown params, unsupported field kinds, invalid values and unknown select
 * options are ignored instead of blocking the prefill of the other fields.
 */
export const getFormPrefillValues = (
  fields: IFieldInstance[],
  query: FormPrefillQuery
): Record<string, unknown> => {
  return fields.reduce(
    (acc, field) => {
      const { id, isComputed, isLookup } = field;
      if (isComputed || isLookup) return acc;

      const value = parsePrefillValue(field, query[id]);
      if (value === undefined) return acc;

      acc[id] = value;
      return acc;
    },
    {} as Record<string, unknown>
  );
};
