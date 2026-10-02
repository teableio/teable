import type { SearchFieldTextProjection } from '@teable/v2-core';

/**
 * Raw-SQL renderers for the canonical search text projections defined in
 * v2-core (`SearchFieldTextProjection`). The record query repository renders
 * the same projections through kysely at query time; the two renderers must
 * stay value-equivalent — the generated document column built here is the
 * indexed prefilter for the exact predicate built there, and the prefilter is
 * only sound while both sides project a cell to the same text.
 */

const MAX_NUMERIC_PRECISION = 20;

// Multi-value cells are physically jsonb; a direct cast plus text-level array
// wrapping keeps the expression immutable — to_jsonb() and jsonb_build_array()
// are only STABLE and are rejected by generated columns.
const normalizeToJsonArraySql = (columnSql: string): string =>
  `CASE WHEN jsonb_typeof((${columnSql})::jsonb) = 'array' THEN (${columnSql})::jsonb ` +
  `WHEN (${columnSql})::jsonb IS NULL THEN '[]'::jsonb ` +
  `ELSE ('[' || ((${columnSql})::jsonb)::text || ']')::jsonb END`;

// `["a", "b"]`::text -> `a, b`, matching the cell text users search for. See
// the kysely twin in RecordSearchWhereBuilder for the escaping caveats.
const joinJsonArrayTextSql = (arraySql: string): string =>
  `btrim(replace(btrim((${arraySql})::text, '[]'), '", "', ', '), '"')`;

export const renderSearchTextProjectionSql = (
  columnSql: string,
  projection?: SearchFieldTextProjection
): string => {
  switch (projection?.kind) {
    case 'multiline':
      return `replace(replace(replace((${columnSql})::text, chr(13), ' '), chr(10), ' '), chr(9), ' ')`;
    case 'structured_title':
      return `((${columnSql})::jsonb #>> '{title}')`;
    case 'structured_title_list':
      return joinJsonArrayTextSql(
        `jsonb_path_query_array(${normalizeToJsonArraySql(columnSql)}, '$[*].**."title"')`
      );
    case 'plain_list':
      return joinJsonArrayTextSql(normalizeToJsonArraySql(columnSql));
    case 'rounded_number_list':
      return `(SELECT string_agg(round(elem.value::numeric, ${sanitizePrecision(projection.precision)})::text, ', ' ORDER BY elem.ordinality) FROM jsonb_array_elements_text(${normalizeToJsonArraySql(columnSql)}) WITH ORDINALITY AS elem(value, ordinality))`;
    case 'rounded_number':
      return `round((${columnSql})::numeric, ${sanitizePrecision(projection.precision)})::text`;
    case 'plain':
    default:
      return `(${columnSql})::text`;
  }
};

const projectionKinds: ReadonlySet<string> = new Set([
  'plain',
  'multiline',
  'plain_list',
  'structured_title',
  'structured_title_list',
  'rounded_number',
  'rounded_number_list',
]);

const sanitizePrecision = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return 0;
  return Math.min(parsed, MAX_NUMERIC_PRECISION);
};

/**
 * Task payloads arrive as JSON; never interpolate an unvalidated projection
 * into DDL. Unknown kinds degrade to the plain text cast.
 */
export const sanitizeSearchTextProjection = (value: unknown): SearchFieldTextProjection => {
  if (typeof value !== 'object' || value === null) return { kind: 'plain' };
  const kind = (value as { kind?: unknown }).kind;
  if (typeof kind !== 'string' || !projectionKinds.has(kind)) return { kind: 'plain' };
  if (kind === 'rounded_number' || kind === 'rounded_number_list') {
    return {
      kind,
      precision: sanitizePrecision((value as { precision?: unknown }).precision),
    };
  }
  return { kind } as SearchFieldTextProjection;
};

export const searchTextProjectionKey = (projection?: SearchFieldTextProjection): string => {
  if (!projection) return 'plain';
  return 'precision' in projection
    ? `${projection.kind}(${sanitizePrecision(projection.precision)})`
    : projection.kind;
};

/** Install only during explicitly writable search-document maintenance. Version
 * the name instead of replacing a function used by existing stored columns. */
export const roundedNumberListSearchFunctionBody = `
  SELECT string_agg(round(elem.value::numeric, precision_digits)::text, ', ' ORDER BY elem.ordinality)
  FROM jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(cell) = 'array' THEN cell
      WHEN cell IS NULL THEN '[]'::jsonb
      ELSE ('[' || cell::text || ']')::jsonb END
  ) WITH ORDINALITY AS elem(value, ordinality)
`;

export const roundedNumberListSearchFunctionSql = `CREATE FUNCTION public.teable_search_rounded_number_list_v1(cell jsonb, precision_digits integer)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog
AS $teable_search$${roundedNumberListSearchFunctionBody}$teable_search$`;

export const requiresRoundedNumberListSearchFunction = (
  projections: ReadonlyArray<SearchFieldTextProjection | undefined>
): boolean => projections.some((projection) => projection?.kind === 'rounded_number_list');

/** Generated columns disallow subqueries; ordinary queries keep the inline
 * expression so read-only analysis and legacy reads need no helper install. */
export const renderGeneratedSearchTextProjectionSql = (
  columnSql: string,
  projection?: SearchFieldTextProjection
): string =>
  projection?.kind === 'rounded_number_list'
    ? `public.teable_search_rounded_number_list_v1((${columnSql})::jsonb, ${sanitizePrecision(projection.precision)})`
    : renderSearchTextProjectionSql(columnSql, projection);
