# Table/Field Schema Notes

## table_meta

Key columns used by debug tools:

- `id` - table id
- `base_id` - base id
- `name` - table name
- `db_table_name` - physical db table name
- `db_view_name` - optional view name
- `order` - table order
- `deleted_time` - soft delete timestamp

## field

Key columns used by debug tools:

- `id` - field id
- `table_id` - parent table id
- `name` - field name
- `type` - field type (lookup/rollup/link/formula/etc.)
- `cell_value_type` - normalized cell type
- `options` - JSON config (string)
- `lookup_options` - JSON lookup config (string)
- `lookup_linked_field_id` - link field id for lookup
- `is_primary` - primary field flag
- `is_computed` - computed field flag
- `is_lookup` - lookup field flag
- `is_pending` - pending/backfill flag
- `has_error` - error state flag
- `db_field_name` - physical db column name

## reference

Used by field dependency graph for formula references:

- `from_field_id` -> `to_field_id` edges
