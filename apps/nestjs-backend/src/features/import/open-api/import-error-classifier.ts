import type { I18nPath } from '../../../types/i18n.generated';

export enum ImportErrorType {
  DATE_OUT_OF_RANGE = 'DATE_OUT_OF_RANGE',
  PLAN_ROW_LIMIT = 'PLAN_ROW_LIMIT',
  NOT_NULL_VALIDATION = 'NOT_NULL_VALIDATION',
  UNIQUE_VALIDATION = 'UNIQUE_VALIDATION',
  REQUEST_TIMEOUT = 'REQUEST_TIMEOUT',
  CHUNK_PROCESSING_FAILED = 'CHUNK_PROCESSING_FAILED',
  UNKNOWN = 'UNKNOWN',
}

export interface IClassifiedError {
  type: ImportErrorType;
  i18nKey: I18nPath;
  /** Context variables for i18n interpolation (e.g. {{fields}}, {{value}}) */
  context: Record<string, string>;
  rawMessage: string;
}

interface IErrorMatcher {
  type: ImportErrorType;
  pattern: RegExp;
  i18nKey: I18nPath;
  extractContext: (match: RegExpMatchArray, raw: string) => Record<string, string>;
}

/**
 * To add a new error pattern:
 * 1. Add enum value to ImportErrorType
 * 2. Add matcher entry to ERROR_MATCHERS with pattern, i18nKey, context extractor
 * 3. Add i18n translations for the new key in all locale files under "import.error.*"
 */
const ERROR_MATCHERS: IErrorMatcher[] = [
  {
    type: ImportErrorType.DATE_OUT_OF_RANGE,
    pattern: /time zone displacement out of range|date\/time field value out of range/i,
    i18nKey: 'common.import.error.dateOutOfRange' as I18nPath,
    extractContext: (_match, raw) => {
      const valueMatch = raw.match(/"([^"]+)"/);
      return { value: valueMatch?.[1] ?? '' };
    },
  },
  {
    type: ImportErrorType.PLAN_ROW_LIMIT,
    pattern: /upgrade your plan to import more records/i,
    i18nKey: 'common.import.error.planRowLimit' as I18nPath,
    extractContext: () => ({}),
  },
  {
    type: ImportErrorType.NOT_NULL_VALIDATION,
    pattern: /Fields?\s+([\w,\s]+)\s+not null validation failed/i,
    i18nKey: 'common.import.error.notNullValidation' as I18nPath,
    extractContext: (match) => ({
      fieldIds: match[1]?.trim() ?? '',
    }),
  },
  {
    type: ImportErrorType.UNIQUE_VALIDATION,
    pattern: /Fields?\s+([\w,\s]+)\s+unique validation failed/i,
    i18nKey: 'common.import.error.uniqueValidation' as I18nPath,
    extractContext: (match) => ({
      fieldIds: match[1]?.trim() ?? '',
    }),
  },
  {
    type: ImportErrorType.REQUEST_TIMEOUT,
    pattern: /request timeout/i,
    i18nKey: 'common.import.error.requestTimeout' as I18nPath,
    extractContext: () => ({}),
  },
  {
    type: ImportErrorType.CHUNK_PROCESSING_FAILED,
    pattern: /^Chunk processing failed:/i,
    i18nKey: 'common.import.error.chunkProcessingFailed' as I18nPath,
    extractContext: (_match, raw) => ({
      reason: raw.replace(/^Chunk processing failed:\s*/i, ''),
    }),
  },
];

export function classifyImportError(rawMessage: string): IClassifiedError {
  for (const matcher of ERROR_MATCHERS) {
    const match = rawMessage.match(matcher.pattern);
    if (match) {
      return {
        type: matcher.type,
        i18nKey: matcher.i18nKey,
        context: matcher.extractContext(match, rawMessage),
        rawMessage,
      };
    }
  }
  return {
    type: ImportErrorType.UNKNOWN,
    i18nKey: 'common.import.error.unknown' as I18nPath,
    context: { message: rawMessage },
    rawMessage,
  };
}

/**
 * Resolve fieldIds in the classified context to human-readable field names.
 * Mutates the context in-place: replaces "fieldIds" key with "fields" key.
 */
export function resolveClassifiedFieldNames(
  classified: IClassifiedError,
  fieldMap: Map<string, string>
): IClassifiedError {
  if (!classified.context.fieldIds) {
    return classified;
  }
  const names = classified.context.fieldIds
    .split(/,\s*/)
    .map((id) => fieldMap.get(id.trim()) ?? id.trim())
    .join(', ');
  return {
    ...classified,
    context: {
      ...classified.context,
      fields: names,
    },
  };
}

export type TranslateFn = (key: I18nPath, args?: Record<string, string>) => string;

/**
 * Format a classified error into a human-readable localized message.
 * @param classified - output from classifyImportError
 * @param translate - i18n translation function (key, args) => string
 * @param fieldMap - optional map from fieldId to fieldName
 * @param failedFieldNames - optional pre-resolved field names from child processor
 */
export function formatClassifiedError(
  classified: IClassifiedError,
  translate: TranslateFn,
  fieldMap?: Map<string, string>,
  failedFieldNames?: string[]
): string {
  const resolved = fieldMap ? resolveClassifiedFieldNames(classified, fieldMap) : classified;

  // Collect all available field names from both sources, deduplicated
  const allFieldNames: string[] = [];
  if (resolved.context.fields) {
    allFieldNames.push(...resolved.context.fields.split(', '));
  }
  if (failedFieldNames?.length) {
    for (const name of failedFieldNames) {
      if (!allFieldNames.includes(name)) {
        allFieldNames.push(name);
      }
    }
  }

  const fieldHint = allFieldNames.length ? `[${allFieldNames.join(', ')}] ` : '';

  const finalContext = { ...resolved.context, fieldHint };

  return translate(resolved.i18nKey, finalContext);
}
