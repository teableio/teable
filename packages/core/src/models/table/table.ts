export class TableCore {
  id!: string;

  name!: string;

  dbTableName!: string;

  dbViewName?: string | null;

  icon?: string;

  description?: string;

  lastModifiedTime!: string;

  defaultViewId!: string;
}
