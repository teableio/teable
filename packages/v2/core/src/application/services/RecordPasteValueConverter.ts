import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import timezone from 'dayjs/plugin/timezone.js';
import utc from 'dayjs/plugin/utc.js';
import { ok, Result } from 'neverthrow';

import type { TemporaryPasteSourceField } from '../../commands/TemporaryPasteCommand';
import { domainError, type DomainError } from '../../domain/shared/DomainError';
import { isoDateTimeWithOffsetSchema } from '../../domain/shared/isoDateTimeSchema';
import type { Field } from '../../domain/table/fields/Field';
import { DateField } from '../../domain/table/fields/types/DateField';
import { FieldDisplayValueVisitor } from '../formatting/FieldDisplayValueVisitor';
import { prepareTemporaryPasteSource } from './TemporaryPasteSource';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);

export type RecordPasteValueConverter = (value: unknown) => Result<unknown, DomainError>;

type LinkPasteItem = { id: string; title?: string };

const absoluteDateTimeSchema = isoDateTimeWithOffsetSchema();

// Source display parsing needs calendar defaults and local-time DST resolution.
// Target-write parsing deliberately keeps its separate strict calendar policy.
const prepareSourceDateParser = (field: DateField) => {
  const formatting = field.formatting();
  const datePattern = formatting.date();
  const timePattern = formatting.time();
  const timeZone = formatting.timeZone().toString();
  return Result.fromThrowable(
    (value: string): string | undefined => {
      const automatic = dayjs(value);
      if (automatic.isValid() && automatic.toISOString() === value) return value;
      const withTime = timePattern !== 'None' && /\d{1,2}:\d{2}(?::\d{2})?/.test(value);
      const pattern = withTime ? `${datePattern} ${timePattern}` : datePattern;
      if (dayjs(value, pattern, true).isValid()) {
        const parsed = dayjs.tz(value, pattern, timeZone);
        if (!parsed.isValid()) return undefined;
        const iso = parsed.toISOString();
        return iso.startsWith('-') ? undefined : iso;
      }
      if (!automatic.isValid()) return undefined;
      const parsed = dayjs.tz(value, timeZone);
      return parsed.isValid() ? parsed.toISOString() : undefined;
    },
    (cause) =>
      domainError.validation({
        code: 'paste.invalid_source_date_value',
        message: 'Invalid source date paste value',
        cause,
      })
  );
};

/** Normalize ordinary link paste values without changing their source-table identities. */
export const normalizeRecordLinkPasteValue = Result.fromThrowable(
  (value: unknown, targetMultiple: boolean): unknown => {
    if (value == null) return null;
    // Equivalent to [value].flat(), not value.flat(): nested source arrays are items,
    // and are discarded unless they themselves carry an id.
    const inputIsArray = Array.isArray(value);
    const length = inputIsArray ? value.length : 1;
    const items: Array<string | LinkPasteItem> = [];
    let allStructured = true;
    for (let index = 0; index < length; index++) {
      const item: unknown = inputIsArray ? value[index] : value;
      if (typeof item === 'string') {
        const token = item.trim();
        if (token) {
          items.push(token);
          allStructured = false;
        }
      } else if (item && typeof item === 'object' && 'id' in item) {
        const id = String(item.id ?? '').trim();
        if (!id) continue;
        const title = 'title' in item ? item.title : undefined;
        items.push(typeof title === 'string' ? { id, title } : { id });
      }
    }
    if (!items.length) return null;
    if (allStructured) return targetMultiple ? items : items[0];
    // Reuse the output array: plain tokens and structured ids share one typecast string.
    for (let index = 0; index < items.length; index++) {
      const item = items[index]!;
      if (typeof item !== 'string') items[index] = item.id;
    }
    return items.join(',');
  },
  (cause) =>
    domainError.validation({
      code: 'paste.invalid_link_cell_value',
      message: 'Invalid link paste value',
      cause,
    })
);

/** Prepare ordinary paste interpretation once per column, before any record writes. */
export const prepareRecordPasteValueConverter = (
  target: Field,
  header: TemporaryPasteSourceField
): Result<RecordPasteValueConverter, DomainError> => {
  const targetType = target.type().toString();
  const targetComputed = target.computed().toBoolean();
  // Ordinary paste leaves computed columns untouched; the write pipeline owns skipping them.
  if (targetComputed) return ok((value) => ok(value));

  return target.isMultipleCellValue().andThen((multiplicity) => {
    const targetMultiple = multiplicity.toBoolean();
    return prepareTemporaryPasteSource(target, header).andThen((source) => {
      const sourceType = source.field.type().toString();
      return source.field.accept(new FieldDisplayValueVisitor(source.multiple)).map((format) => {
        const sourceDate = source.field instanceof DateField ? source.field : undefined;
        const sameIdentities =
          (targetType === 'user' || targetType === 'attachment') && sourceType === targetType;
        const sameDate = targetType === 'date' && sourceDate !== undefined;
        const parseSourceDate =
          sameDate && source.multiple ? prepareSourceDateParser(sourceDate) : undefined;
        const sameSelect =
          (targetType === 'singleSelect' || targetType === 'multipleSelect') &&
          (sourceType === 'singleSelect' || sourceType === 'multipleSelect');
        const sameLink = targetType === 'link' && sourceType === 'link';

        return (value: unknown): Result<unknown, DomainError> => {
          if (value == null) return ok(null);
          if (sameIdentities) {
            const items = Array.isArray(value) ? value : [value];
            return ok(targetMultiple ? items : items[0]);
          }
          if (sameDate) {
            // A Date lookup's first raw entry may itself be an array; do not flatten it.
            if (Array.isArray(value)) return ok(value[0]);
            if (typeof value === 'string' && source.multiple && parseSourceDate) {
              const segments: string[] = [];
              for (const part of value.split(',')) {
                const segment = part.trim();
                if (segment) segments.push(segment);
              }
              if (segments.length > 1) {
                let candidate = '';
                for (const segment of segments) {
                  candidate = candidate ? `${candidate}, ${segment}` : segment;
                  const parsed = parseSourceDate(candidate);
                  if (parsed.isErr()) return parsed;
                  if (parsed.value != null) return ok(parsed.value);
                }
                return ok(segments[0]);
              }
            }
            return ok(value);
          }
          if (sameSelect) {
            if (!Array.isArray(value)) return ok(value);
            const items = value.flat();
            return ok(targetMultiple ? items : items[0]);
          }
          if (sameLink) return normalizeRecordLinkPasteValue(value, targetMultiple);
          // Only datetime sources can already contain rendered display text. Numeric
          // strings still need source formatting (notably percent/currency formatting).
          if (
            source.dateTime &&
            typeof value === 'string' &&
            (!value.includes('T') || !absoluteDateTimeSchema.safeParse(value).success)
          ) {
            return ok(value);
          }
          return format(value).map((formatted) => formatted ?? null);
        };
      });
    });
  });
};
