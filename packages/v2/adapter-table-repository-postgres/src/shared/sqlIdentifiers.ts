export type QualifiedIdentifierLiteral = string & {
  readonly __brand: 'QualifiedIdentifierLiteral';
};

const quoteIdentifierName = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;

export const splitSchemaQualifiedTableName = (
  tableName: string
): { schemaName?: string; plainTableName: string } => {
  // Accepts raw generated schema/table names only, not already-quoted identifiers
  // whose contents may themselves contain dots.
  const splitIndex = tableName.indexOf('.');
  if (splitIndex === -1) {
    return { plainTableName: tableName };
  }

  return {
    schemaName: tableName.slice(0, splitIndex),
    plainTableName: tableName.slice(splitIndex + 1),
  };
};

export const toQualifiedIdentifierLiteral = (
  schemaOrTableName: string | null | undefined,
  tableName?: string
): QualifiedIdentifierLiteral => {
  if (tableName != null) {
    return (
      schemaOrTableName
        ? `${quoteIdentifierName(schemaOrTableName)}.${quoteIdentifierName(tableName)}`
        : quoteIdentifierName(tableName)
    ) as QualifiedIdentifierLiteral;
  }

  const { schemaName, plainTableName } = splitSchemaQualifiedTableName(schemaOrTableName ?? '');
  return (
    schemaName
      ? `${quoteIdentifierName(schemaName)}.${quoteIdentifierName(plainTableName)}`
      : quoteIdentifierName(plainTableName)
  ) as QualifiedIdentifierLiteral;
};
