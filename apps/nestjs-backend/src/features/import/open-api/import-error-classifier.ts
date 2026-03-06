import type { I18nPath } from '../../../types/i18n.generated';

export enum ImportErrorType {
  DateOutOfRange = 'DATE_OUT_OF_RANGE',
  PlanRowLimit = 'PLAN_ROW_LIMIT',
  NotNullValidation = 'NOT_NULL_VALIDATION',
  UniqueValidation = 'UNIQUE_VALIDATION',
  RequestTimeout = 'REQUEST_TIMEOUT',
  ChunkProcessingFailed = 'CHUNK_PROCESSING_FAILED',
  Unknown = 'UNKNOWN',
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
const errorMatchers: IErrorMatcher[] = [
  {
    type: ImportErrorType.DateOutOfRange,
    pattern: /time zone displacement out of range|date\/time field value out of range/i,
    i18nKey: 'common.import.error.dateOutOfRange' as I18nPath,
    extractContext: (_match, raw) => {
      const valueMatch = raw.match(/"([^"]+)"/);
      return { value: valueMatch?.[1] ?? '' };
    },
  },
  {
    type: ImportErrorType.PlanRowLimit,
    pattern: /upgrade your plan to import more records/i,
    i18nKey: 'common.import.error.planRowLimit' as I18nPath,
    extractContext: () => ({}),
  },
  {
    type: ImportErrorType.NotNullValidation,
    pattern: /Fields?\s+(\w+(?:\s*,\s*\w+)*)\s+not null validation failed/i,
    i18nKey: 'common.import.error.notNullValidation' as I18nPath,
    extractContext: (match) => ({
      fieldIds: match[1]?.trim() ?? '',
    }),
  },
  {
    type: ImportErrorType.UniqueValidation,
    pattern: /Fields?\s+(\w+(?:\s*,\s*\w+)*)\s+unique validation failed/i,
    i18nKey: 'common.import.error.uniqueValidation' as I18nPath,
    extractContext: (match) => ({
      fieldIds: match[1]?.trim() ?? '',
    }),
  },
  {
    type: ImportErrorType.RequestTimeout,
    pattern: /request timeout/i,
    i18nKey: 'common.import.error.requestTimeout' as I18nPath,
    extractContext: () => ({}),
  },
  {
    type: ImportErrorType.ChunkProcessingFailed,
    pattern: /^Chunk processing failed:/i,
    i18nKey: 'common.import.error.chunkProcessingFailed' as I18nPath,
    extractContext: (_match, raw) => ({
      reason: raw.replace(/^Chunk processing failed:\s*/i, ''),
    }),
  },
];

export function classifyImportError(rawMessage: string): IClassifiedError {
  for (const matcher of errorMatchers) {
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
    type: ImportErrorType.Unknown,
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

export type ITranslateFn = (key: I18nPath, args?: Record<string, string>) => string;

/**
 * Format a classified error into a human-readable localized message.
 * @param classified - output from classifyImportError
 * @param translate - i18n translation function (key, args) => string
 * @param fieldMap - optional map from fieldId to fieldName
 * @param failedFieldNames - optional pre-resolved field names from child processor
 */
export function formatClassifiedError(
  classified: IClassifiedError,
  translate: ITranslateFn,
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
