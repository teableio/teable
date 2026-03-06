import { DriverClient, HttpErrorCode } from '@teable/core';
import type { AST } from 'node-sql-parser';
import { Parser } from 'node-sql-parser';
import { CustomHttpException } from '../../custom.exception';

export const validateRoleOperations = (sql: string) => {
  const removeQuotedContent = (sql: string) => {
    return sql.replace(/'[^']*'|"[^"]*"/g, ' ');
  };

  const normalizedSql = sql.toLowerCase().replace(/\s+/g, ' ');
  const sqlWithoutQuotes = removeQuotedContent(normalizedSql);

  const roleOperationPatterns = [/set\s+role/, /reset\s+role/, /set\s+session/];

  for (const pattern of roleOperationPatterns) {
    if (pattern.test(sqlWithoutQuotes)) {
      throw new CustomHttpException(
        `not allowed to execute sql with keyword ${pattern.source}`,
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.baseSqlExecutor.notAllowedToExecuteSqlWithKeyword',
            context: {
              keyword: pattern.source,
            },
          },
        }
      );
    }
  }
};

const databaseTypeMap = {
  [DriverClient.Pg]: 'postgresql',
  [DriverClient.Sqlite]: 'sqlite',
};

const collectWithNames = (ast?: AST) => {
  if (!ast) {
    return [];
  }
  const withNames: string[] = [];
  if (ast.type === 'select' && ast.with) {
    ast.with.forEach((withItem) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const names = (withItem.stmt as any) ? collectWithNames(withItem.stmt as any) : [];
      withNames.push(...names, withItem.name.value);
    });
  }
  return withNames;
};

export const checkTableAccess = (
  sql: string,
  {
    tableNames,
    database,
  }: {
    tableNames: string[];
    database: DriverClient;
  }
) => {
  const parser = new Parser();
  const opt = {
    database: databaseTypeMap[database],
  };
  const { ast } = parser.parse(sql, opt);
  const withNames = Array.isArray(ast) ? ast.map(collectWithNames).flat() : collectWithNames(ast);
  const allWithNames = new Set([...withNames, ...tableNames]);
  const whiteColumnList = Array.from(allWithNames).map((table) => {
    const [schema, tableName] = table.includes('.') ? table.split('.') : [null, table];
    return `select::${schema}::${tableName}`;
  });

  try {
    const error = parser.whiteListCheck(sql, whiteColumnList, opt);
    if (error) {
      throw error;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    const sqlTableList = parser.tableList(sql, opt);
    const invalidEntries = sqlTableList.filter((t: string) => !whiteColumnList.includes(t));
    const invalidTableNames = invalidEntries.map((t: string) => {
      const parts = t.split('::');
      return parts[parts.length - 1];
    });

    const message =
      invalidTableNames.length > 0
        ? `Table ${invalidTableNames.map((n: string) => `'${n}'`).join(', ')} not found. Please use the db table name (dbTableName from get-tables-meta) instead of the display table name for SQL queries.`
        : (error?.message as string);

    throw new CustomHttpException(
      `An error occurred while checking table access: ${message}`,
      HttpErrorCode.VALIDATION_ERROR,
      {
        localization: {
          i18nKey: 'httpErrors.baseSqlExecutor.whiteListCheckError',
          context: {
            message,
          },
        },
      }
    );
  }
};

export const getTableNames = (sql: string) => {
  const parser = new Parser();
  const opt = {
    database: databaseTypeMap[DriverClient.Pg],
  };
  return parser.tableList(sql, opt);
};
