import type { ICreateTableRequestDto, ICreateTablesRequestDto } from '@teable/v2-contract-http';

export type TableTemplateDefinition = {
  key: string;
  name: string;
  description: string;
  defaultRecordCount?: number;
  tables: ReadonlyArray<TableTemplateTablePreview>;
  createInput: (
    baseId: string,
    options?: CreateTableTemplateInputOptions
  ) => ICreateTablesRequestDto;
};

export type TableTemplateTablePreview = {
  key: string;
  name: string;
  description?: string;
  fieldCount: number;
  defaultRecordCount: number;
};

export type CreateTableTemplateInputOptions = {
  includeRecords?: boolean;
  /**
   * If provided:
   * - single-table templates: uses this as the table name
   * - multi-table templates: prefixes table names as `${namePrefix} - ${tableName}`
   */
  namePrefix?: string;
};

export type SingleTableSeed = {
  fields: NonNullable<ICreateTableRequestDto['fields']>;
  records?: ICreateTableRequestDto['records'];
  defaultRecordCount?: number;
};

export type TemplateTableSeed = {
  key: string;
  name: string;
  description?: string;
  tableId?: string;
  fields: NonNullable<ICreateTableRequestDto['fields']>;
  records?: ICreateTableRequestDto['records'];
  defaultRecordCount?: number;
  /**
   * Function to dynamically build all records for this table.
   * If provided, this will be used instead of normalizing the static `records` array.
   * This allows generating unique content for each record.
   * @param count - The number of records to generate
   */
  buildRecords?: (count: number) => NonNullable<ICreateTableRequestDto['records']>;
};

export type TemplateSeed = {
  tables: ReadonlyArray<TemplateTableSeed>;
};

export type TemplateRecord = NonNullable<ICreateTableRequestDto['records']>[number];
