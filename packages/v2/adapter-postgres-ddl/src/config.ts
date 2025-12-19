import type { IV2PostgresDbConfig } from '@teable/v2-db-postgres';
import { v2PostgresDbConfigSchema } from '@teable/v2-db-postgres';

export const v2PostgresDdlAdapterConfigSchema = v2PostgresDbConfigSchema;

export type IV2PostgresDdlAdapterConfig = IV2PostgresDbConfig;
