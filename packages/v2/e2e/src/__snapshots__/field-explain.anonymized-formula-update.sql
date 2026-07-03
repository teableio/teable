update "<base-id>"."<line-table-id>" as "u" set "__version" = "u"."__version" + 1, "delta_explanation" = "c"."__set_delta_explanation", "action_line_text" = "c"."__set_action_line_text" from (select "c_src"."__id" as "__id", "c_src"."delta_explanation"::text as "__set_delta_explanation", "c_src"."action_line_text"::text as "__set_action_line_text" from (WITH "level_0" AS (SELECT "t"."__id", ((CASE WHEN COALESCE((NOT COALESCE("t"."is_delta", FALSE)), FALSE) THEN NULL ELSE (COALESCE((((COALESCE((((COALESCE((((COALESCE((((COALESCE((((COALESCE((((COALESCE((('
* ')::text), '') || COALESCE((("t"."item_label")::text), '')))::text), '') || COALESCE(((' (code ')::text), '')))::text), '') || COALESCE((("t"."item_code")::text), '')))::text), '') || COALESCE(((') : delta ')::text), '')))::text), '') || COALESCE(((("t"."amount_delta")::text)::text), '')))::text), '') || COALESCE(((' units. ')::text), '')))::text), '') || COALESCE((((CASE WHEN COALESCE((COALESCE("t"."delta_reason", '') = COALESCE(NULL, '')), FALSE) THEN 'No source breakdown.' ELSE "t"."delta_reason" END))::text), '')) END)) as "delta_explanation", ((CASE WHEN COALESCE((NOT COALESCE("t"."action_eligible", FALSE)), FALSE) THEN NULL ELSE (COALESCE((((COALESCE((((COALESCE((((COALESCE((((COALESCE((((COALESCE((((COALESCE((((COALESCE((((COALESCE((((COALESCE((((COALESCE((('
- ')::text), '') || COALESCE((("t"."item_label")::text), '')))::text), '') || COALESCE(((' (code ')::text), '')))::text), '') || COALESCE((("t"."item_code")::text), '')))::text), '') || COALESCE(((') : billed ')::text), '')))::text), '') || COALESCE(((("t"."amount")::text)::text), '')))::text), '') || COALESCE(((' units, actual value ')::text), '')))::text), '') || COALESCE((((
      SELECT string_agg(trim(to_char((elem #>> '{}')::numeric, '999999990D00')), ', ' ORDER BY ord)
      FROM jsonb_array_elements((SELECT CASE
        WHEN _lkp.v IS NULL THEN '[]'::jsonb
        WHEN jsonb_typeof(_lkp.v) = 'null' THEN '[]'::jsonb
        WHEN jsonb_typeof(_lkp.v) = 'array' THEN _lkp.v
        ELSE jsonb_build_array(_lkp.v)
      END FROM (SELECT (CASE
    WHEN (("t"."actual_value")) IS NULL THEN NULL
    WHEN pg_typeof((("t"."actual_value"))) = 'jsonb'::regtype THEN to_jsonb((("t"."actual_value")))
    WHEN pg_typeof((("t"."actual_value"))) = 'json'::regtype THEN to_jsonb((("t"."actual_value")))
    WHEN pg_typeof((("t"."actual_value"))) IN ('text', 'varchar', 'bpchar', 'character varying', 'unknown') THEN
      CASE
        WHEN NULLIF(BTRIM(((("t"."actual_value")))::text), '') IS NULL THEN NULL
        WHEN (LEFT(BTRIM(((("t"."actual_value")))::text), 1) IN ('[', '{')) AND pg_input_is_valid(((("t"."actual_value")))::text, 'jsonb') THEN (((("t"."actual_value")))::text)::jsonb
        ELSE to_jsonb(((("t"."actual_value")))::text)
      END
    ELSE to_jsonb((("t"."actual_value")))
  END) AS v) AS _lkp)) WITH ORDINALITY AS _jae(elem, ord)
    ))::text), '')))::text), '') || COALESCE(((' units (reference) -> delta ')::text), '')))::text), '') || COALESCE(((("t"."amount_delta")::text)::text), '')))::text), '') || COALESCE(((' units -- ')::text), '')))::text), '') || COALESCE((("t"."action_reason")::text), '')) END)) as "action_line_text" FROM "<base-id>"."<line-table-id>" AS "t" INNER JOIN "tmp_computed_dirty" AS "__dirty" ON "t"."__id" = "__dirty"."record_id" AND "__dirty"."table_id" = '<line-table-id>') SELECT "u"."__id", "level_0"."delta_explanation" as "delta_explanation", "level_0"."action_line_text" as "action_line_text" FROM "<base-id>"."<line-table-id>" AS "u" JOIN "level_0" ON "u"."__id" = "level_0"."__id") as "c_src") as "c" where "u"."__id" = "c"."__id" and ("u"."delta_explanation" IS DISTINCT FROM "c"."__set_delta_explanation" OR "u"."action_line_text" IS DISTINCT FROM "c"."__set_action_line_text")