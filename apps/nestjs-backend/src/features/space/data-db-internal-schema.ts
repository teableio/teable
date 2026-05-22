import { createHash } from 'crypto';

const postgresIdentifierPattern = /^[a-z_]\w*$/i;
const byodbInternalSchemaPrefix =
  process.env.BYODB_DATA_DB_INTERNAL_SCHEMA_PREFIX?.trim() || 'teable';

const getDataDbIdentity = (url: string) => {
  const parsed = new URL(url);
  const database = parsed.pathname.replace(/^\//, '');
  return `${parsed.hostname}:${parsed.port}/${database}`;
};

export const generateDataDbInternalSchema = (url: string) => {
  const digest = createHash('sha256').update(getDataDbIdentity(url)).digest('hex').slice(0, 16);
  return `${byodbInternalSchemaPrefix}_${digest}`;
};

export const resolveDataDbInternalSchema = (internalSchema: string | undefined, url: string) => {
  const resolved = internalSchema?.trim() || generateDataDbInternalSchema(url);
  if (!postgresIdentifierPattern.test(resolved)) {
    throw new Error('Invalid data database internal schema name');
  }
  return resolved;
};

export const quoteDataDbIdentifier = (identifier: string) =>
  `"${identifier.replaceAll('"', '""')}"`;

export const withDataDbInternalSchemaParam = (url: string, internalSchema: string) => {
  const parsed = new URL(url);
  parsed.searchParams.set('schema', internalSchema);
  parsed.searchParams.set('options', `-c search_path=${internalSchema}`);
  return parsed.toString();
};
