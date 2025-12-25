/* eslint-disable @typescript-eslint/naming-convention */
import type { ColumnType } from 'kysely';

export interface V1SpaceTable {
  id: string;
  name: string;
  credit: number | null;
  deleted_time: ColumnType<Date | null, Date | null | undefined, Date | null | undefined>;
  created_time: ColumnType<Date, Date | undefined, never>;
  created_by: string;
  last_modified_by: string | null;
  last_modified_time: ColumnType<Date | null, Date | null | undefined, Date | null | undefined>;
  is_template: boolean | null;
}

export interface V1BaseTable {
  id: string;
  space_id: string;
  name: string;
  order: number;
  icon: string | null;
  schema_pass: string | null;
  deleted_time: ColumnType<Date | null, Date | null | undefined, Date | null | undefined>;
  created_time: ColumnType<Date, Date | undefined, never>;
  created_by: string;
  last_modified_by: string | null;
  last_modified_time: ColumnType<Date | null, Date | null | undefined, Date | null | undefined>;
}

export interface V1TableMetaTable {
  id: string;
  base_id: string;
  name: string;
  description: string | null;
  icon: string | null;
  db_table_name: string;
  db_view_name: string | null;
  version: number;
  order: number;
  created_time: ColumnType<Date, Date | undefined, never>;
  last_modified_time: ColumnType<Date | null, Date | null | undefined, Date | null | undefined>;
  deleted_time: ColumnType<Date | null, Date | null | undefined, Date | null | undefined>;
  created_by: string;
  last_modified_by: string | null;
}

export interface V1FieldTable {
  id: string;
  name: string;
  description: string | null;
  options: string | null;
  meta: string | null;
  ai_config: string | null;
  type: string;
  cell_value_type: string;
  is_multiple_cell_value: boolean | null;
  db_field_type: string;
  db_field_name: string;
  not_null: boolean | null;
  unique: boolean | null;
  is_primary: boolean | null;
  is_computed: boolean | null;
  is_lookup: boolean | null;
  is_conditional_lookup: boolean | null;
  is_pending: boolean | null;
  has_error: boolean | null;
  lookup_linked_field_id: string | null;
  lookup_options: string | null;
  table_id: string;
  order: number;
  version: number;
  created_time: ColumnType<Date, Date | undefined, never>;
  last_modified_time: ColumnType<Date | null, Date | null | undefined, Date | null | undefined>;
  deleted_time: ColumnType<Date | null, Date | null | undefined, Date | null | undefined>;
  created_by: string;
  last_modified_by: string | null;
}

export interface V1ViewTable {
  id: string;
  name: string;
  description: string | null;
  table_id: string;
  type: string;
  sort: string | null;
  filter: string | null;
  group: string | null;
  options: string | null;
  order: number;
  version: number;
  column_meta: string;
  is_locked: boolean | null;
  enable_share: boolean | null;
  share_id: string | null;
  share_meta: string | null;
  created_time: ColumnType<Date, Date | undefined, never>;
  last_modified_time: ColumnType<Date | null, Date | null | undefined, Date | null | undefined>;
  deleted_time: ColumnType<Date | null, Date | null | undefined, Date | null | undefined>;
  created_by: string;
  last_modified_by: string | null;
}

export interface V1ReferenceTable {
  id: string;
  from_field_id: string;
  to_field_id: string;
  created_time: ColumnType<Date, Date | undefined, never>;
}

export interface V1TeableDatabase {
  space: V1SpaceTable;
  base: V1BaseTable;
  table_meta: V1TableMetaTable;
  field: V1FieldTable;
  view: V1ViewTable;
  reference: V1ReferenceTable;
}
