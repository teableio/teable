export type QualifiedIdentifierLiteral = string & {
  readonly __brand: 'QualifiedIdentifierLiteral';
};

const POSTGRES_IDENTIFIER_MAX_LENGTH = 63;

const quoteIdentifierName = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;

const hashIdentifier = (identifier: string): string => {
  let hash = 2166136261;
  for (let i = 0; i < identifier.length; i++) {
    hash ^= identifier.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
};

export const toPostgresIdentifierWithHash = (identifier: string): string => {
  if (identifier.length <= POSTGRES_IDENTIFIER_MAX_LENGTH) {
    return identifier;
  }

  const suffix = `_${hashIdentifier(identifier)}`;
  return `${identifier.slice(0, POSTGRES_IDENTIFIER_MAX_LENGTH - suffix.length)}${suffix}`;
};

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
