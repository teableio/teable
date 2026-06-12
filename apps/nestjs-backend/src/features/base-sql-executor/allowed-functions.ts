/**
 * Whitelist of PostgreSQL functions allowed in user-facing sql-query API.
 * Any function NOT in this set will be rejected at the AST validation layer.
 *
 * Criteria for inclusion:
 *   - IMMUTABLE or STABLE, or VOLATILE but side-effect-free (e.g. now(), timezone())
 *   - Cannot execute embedded SQL (excludes query_to_xml, ts_stat, ts_rewrite, etc.)
 *   - Cannot modify database state (excludes setval, lo_create, set_config, etc.)
 *   - Cannot acquire locks or send notifications (excludes pg_advisory_lock, pg_notify, etc.)
 *   - Cannot generate unbounded rows from nothing (excludes generate_series)
 */
export const allowedFunctions = new Set([
  // ── Aggregation ──
  'avg',
  'bool_and',
  'bool_or',
  'count',
  'every',
  'json_agg',
  'jsonb_agg',
  'max',
  'min',
  'string_agg',
  'sum',
  'array_agg',

  // ── Window ──
  'cume_dist',
  'dense_rank',
  'first_value',
  'lag',
  'last_value',
  'lead',
  'nth_value',
  'ntile',
  'percent_rank',
  'rank',
  'row_number',

  // ── Math ──
  'abs',
  'ceil',
  'ceiling',
  'div',
  'floor',
  'greatest',
  'least',
  'mod',
  'power',
  'pow',
  'round',
  'sign',
  'sqrt',
  'trunc',

  // ── String ──
  'ascii',
  'char_length',
  'chr',
  'concat',
  'concat_ws',
  'initcap',
  'left',
  'length',
  'lower',
  'lpad',
  'ltrim',
  'md5',
  'position',
  'regexp_match',
  'regexp_matches',
  'regexp_replace',
  'repeat',
  'replace',
  'reverse',
  'right',
  'rpad',
  'rtrim',
  'split_part',
  'starts_with',
  'strpos',
  'substr',
  'substring',
  'translate',
  'trim',
  'upper',

  // ── Date / Time ──
  'age',
  'date_part',
  'date_trunc',
  'extract',
  'make_date',
  'make_timestamp',
  'now',
  'to_char',
  'to_date',
  'to_number',
  'to_timestamp',
  'timezone',

  // ── JSON / JSONB ──
  'json_array_elements',
  'json_array_elements_text',
  'json_array_length',
  'json_build_array',
  'json_build_object',
  'json_extract_path',
  'json_extract_path_text',
  'json_typeof',
  'jsonb_array_elements',
  'jsonb_array_elements_text',
  'jsonb_array_length',
  'jsonb_build_array',
  'jsonb_build_object',
  'jsonb_each',
  'jsonb_each_text',
  'jsonb_extract_path',
  'jsonb_extract_path_text',
  'jsonb_object_keys',
  'jsonb_pretty',
  'jsonb_set',
  'jsonb_strip_nulls',
  'jsonb_typeof',
  'to_json',
  'to_jsonb',

  // ── Array ──
  'array_append',
  'array_cat',
  'array_length',
  'array_position',
  'array_remove',
  'array_to_string',
  'string_to_array',
  'unnest',

  // ── Conditional ──
  'coalesce',
  'nullif',

  // ── Type conversion ──
  'cast',
]);
