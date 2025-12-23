import type { IV2PostgresDbConfig } from '@teable/v2-adapter-db-postgres-pg';
import { v2PostgresDbConfigSchema } from '@teable/v2-adapter-db-postgres-pg';

export const v2PostgresDdlAdapterConfigSchema = v2PostgresDbConfigSchema;

export type IV2PostgresDdlAdapterConfig = IV2PostgresDbConfig;
