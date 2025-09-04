import { BadRequestException } from '@nestjs/common';
import { DriverClient } from '@teable/core';
import type { AST } from 'node-sql-parser';
import { Parser } from 'node-sql-parser';

export const validateRoleOperations = (sql: string) => {
  const removeQuotedContent = (sql: string) => {
    return sql.replace(/'[^']*'|"[^"]*"/g, ' ');
  };

  const normalizedSql = sql.toLowerCase().replace(/\s+/g, ' ');
  const sqlWithoutQuotes = removeQuotedContent(normalizedSql);

  const roleOperationPatterns = [/set\s+role/, /reset\s+role/, /set\s+session/];

  for (const pattern of roleOperationPatterns) {
    if (pattern.test(sqlWithoutQuotes)) {
      throw new BadRequestException(`not allowed to execute sql with keyword: ${pattern.source}`);
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
    throw new BadRequestException(
      error?.message || 'An error occurred while checking table access.'
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
