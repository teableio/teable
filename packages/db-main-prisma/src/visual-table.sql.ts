export const visualTableSql = (dbTableName: string) => `
  CREATE TABLE ${dbTableName} (
    __id TEXT NOT NULL UNIQUE,
    __auto_number INTEGER PRIMARY KEY AUTOINCREMENT,
    __row_default INTEGER NOT NULL,
    __created_time DATETIME NOT NULL,
    __last_modified_time DATETIME,
    __created_by TEXT NOT NULL,
    __last_modified_by TEXT,
    __version INTEGER NOT NULL,
  );
`;
