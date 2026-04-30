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
  const { ast } = (() => {
    try {
      return parser.parse(sql, opt);
    } catch {
      throw new CustomHttpException(
        'SQL syntax error, please check your query',
        HttpErrorCode.VALIDATION_ERROR,
        {
          localization: {
            i18nKey: 'httpErrors.baseSqlExecutor.sqlSyntaxError',
          },
        }
      );
    }
  })();
  const withNames = Array.isArray(ast) ? ast.flatMap(collectWithNames) : collectWithNames(ast);
  const allowedTables = new Set([...withNames, ...tableNames]);
  const whiteColumnList = Array.from(allowedTables).map((table) => {
    const [schema, tableName] = table.includes('.') ? table.split('.') : [null, table];
    return `select::${schema}::${tableName}`;
  });

  let whiteListError: Error | undefined;
  try {
    whiteListError = parser.whiteListCheck(sql, whiteColumnList, opt);
    if (!whiteListError) return;
  } catch (e) {
    whiteListError = e as Error;
  }

  const sqlTableList = parser.tableList(sql, opt);
  const invalidTableNames = sqlTableList
    .filter((t: string) => !whiteColumnList.includes(t))
    .map((t: string) => t.split('::').pop()!);

  const message =
    invalidTableNames.length > 0
      ? `Table ${invalidTableNames.map((n: string) => `'${n}'`).join(', ')} not found. ` +
        `dbTableName from get-tables-meta is already \`schema.table\` (e.g. \`bseXXX.tblYYY\`); ` +
        `use it in SQL as \`FROM "bseXXX"."tblYYY"\`.`
      : String(whiteListError?.message ?? whiteListError);

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
};

export const getTableNames = (sql: string) => {
  const parser = new Parser();
  const opt = {
    database: databaseTypeMap[DriverClient.Pg],
  };
  return parser.tableList(sql, opt);
};
