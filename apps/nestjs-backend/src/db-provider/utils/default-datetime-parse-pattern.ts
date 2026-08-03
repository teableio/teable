/**
 * Shared default pattern used to guard DATETIME_PARSE inputs.
 * The expression must not contain any literal '?' characters because Knex
 * would misinterpret them as parameter placeholders when embedding the regex.
 */
export const DEFAULT_DATETIME_PARSE_PATTERN = (() => {
  const optional = (expr: string) => `(${expr}|)`;
  const digitPair = '[0-9]{2}';
  const hour = '[0-9]{1,2}';
  const fractionalSeconds = '[.][0-9]{1,6}';
  const secondSegment = ':' + digitPair + optional(fractionalSeconds);
  const timeZoneSegment = `(Z|[+-]${digitPair}|[+-]${digitPair}${digitPair}|[+-]${digitPair}:${digitPair})`;
  const timePart = `[ T]${hour}:${digitPair}` + optional(secondSegment) + optional(timeZoneSegment);

  // Support both single-digit (e.g., 2026-9-15) and double-digit (e.g., 2026-09-15) month/day
  return '^' + '[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}' + optional(timePart) + '$';
})();

export const getDefaultDatetimeParsePattern = (): string => DEFAULT_DATETIME_PARSE_PATTERN;
