/**
 * Shared helpers for regular lookup-of-formula option handling (T6332).
 *
 * Regular lookups resolve values from the foreign field storage. They must never
 * keep a foreign formula expression (which references foreign field IDs) as a
 * host formula. Conditional lookups still need a real expression and must not
 * use the placeholder helpers.
 */

/** Parseable placeholder expression — never empty, never foreign field refs. */
export const LOOKUP_FORMULA_PLACEHOLDER_EXPRESSION = '""';

const LOOKUP_FORMULA_EXECUTABLE_OPTION_KEYS = ['expression', 'timeZone'] as const;

/** Display-only keys that may override the looked-up source field. */
const LOOKUP_DISPLAY_OPTION_KEYS = ['formatting', 'showAs'] as const;

export type RegularLookupFormulaOptions = {
  expression: typeof LOOKUP_FORMULA_PLACEHOLDER_EXPRESSION;
  formatting?: unknown;
  showAs?: unknown;
};

export const stripLookupFormulaExecutableOptions = (
  options: unknown
): Record<string, unknown> | undefined => {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    return undefined;
  }

  const next: Record<string, unknown> = { ...(options as Record<string, unknown>) };
  for (const key of LOOKUP_FORMULA_EXECUTABLE_OPTION_KEYS) {
    delete next[key];
  }
  return next;
};

/**
 * Display options for a regular lookup-of-formula field.
 * Keeps formatting/showAs while forcing a parseable placeholder expression.
 */
export const toRegularLookupFormulaOptions = (options: unknown): RegularLookupFormulaOptions => {
  const display = stripLookupFormulaExecutableOptions(options) ?? {};
  const next: RegularLookupFormulaOptions = {
    expression: LOOKUP_FORMULA_PLACEHOLDER_EXPRESSION,
  };
  if (Object.prototype.hasOwnProperty.call(display, 'formatting')) {
    next.formatting = display.formatting;
  }
  if (Object.prototype.hasOwnProperty.call(display, 'showAs')) {
    next.showAs = display.showAs;
  }
  return next;
};

/**
 * Recover display overrides after reload so later lookupOptions-only updates do not
 * drop formatting/showAs when the inner field is re-resolved from the source field.
 * `null` is a deliberate clear tombstone and must be preserved across reload.
 */
export const extractLookupDisplayOptionsPatch = (
  options: unknown
): Readonly<Record<string, unknown>> | undefined => {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    return undefined;
  }

  const source = options as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const key of LOOKUP_DISPLAY_OPTION_KEYS) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      // Keep null tombstones; only skip missing keys.
      patch[key] = source[key];
    }
  }
  return Object.keys(patch).length > 0 ? patch : undefined;
};

const displayOptionEquals = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => displayOptionEquals(value, right[index]));
  }
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') {
    return false;
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] && displayOptionEquals(leftRecord[key], rightRecord[key])
    )
  );
};

/**
 * Rehydrated lookup options are flattened with the source field options. Keep only
 * values that differ from the source, plus null tombstones, as explicit overrides.
 */
export const inferLookupDisplayOptionsPatch = (
  options: unknown,
  sourceOptions: unknown
): Readonly<Record<string, unknown>> | undefined => {
  const candidate = extractLookupDisplayOptionsPatch(options);
  if (!candidate) return undefined;

  const source = extractLookupDisplayOptionsPatch(sourceOptions);
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(candidate)) {
    const hasSourceValue = source && Object.prototype.hasOwnProperty.call(source, key);
    if (value === null || !hasSourceValue || !displayOptionEquals(value, source?.[key])) {
      patch[key] = value;
    }
  }
  return Object.keys(patch).length > 0 ? patch : undefined;
};
