import { Inject, Injectable, Optional } from '@nestjs/common';
import { parseDsn } from '@teable/core';
import type {
  IDataDbConnectionSummaryVo,
  IDataDbPreflightRo,
  IDataDbPreflightVo,
} from '@teable/openapi';
import { PrismaService } from '@teable/db-main-prisma';
import { createHash } from 'crypto';
import { promises as dns } from 'dns';
import { isIP } from 'net';
import type { Knex } from 'knex';
import createKnex from 'knex';

type IPreflightCapabilities = IDataDbPreflightVo['capabilities'];
type IPreflightClassification = IDataDbPreflightVo['classification'];
type IPreflightError = IDataDbPreflightVo['errors'][number];

export interface IDataDbPreflightClient {
  raw<T = unknown>(sql: string, bindings?: unknown[]): Promise<{ rows?: T[] } | T[]>;
  destroy(): Promise<void>;
}

export type IDataDbPreflightClientFactory = (url: string) => IDataDbPreflightClient;
export const DATA_DB_PREFLIGHT_CLIENT_FACTORY = Symbol('DATA_DB_PREFLIGHT_CLIENT_FACTORY');

const DATA_PLANE_TABLES = [
  'computed_update_outbox',
  'computed_update_outbox_seed',
  'computed_update_dead_letter',
  'computed_update_pause_scope',
  'record_history',
  'table_trash',
  'record_trash',
  '__undo_log',
];

const DATA_PLANE_FUNCTIONS = ['__teable_capture_undo_row'];
const ALLOWED_PUBLIC_TABLES = new Set([...DATA_PLANE_TABLES, '_prisma_migrations']);
const DEFAULT_CAPABILITIES: IPreflightCapabilities = {
  createSchema: false,
  createTable: false,
  createFunction: false,
  createTrigger: false,
  createRole: false,
  grantPrivileges: false,
  inspectActivity: false,
};

const PRIVATE_NETWORK_ERROR: IPreflightError = {
  code: 'PRIVATE_NETWORK_BLOCKED',
  message: 'Private network database hosts are blocked by default',
  remediation: 'Set TEABLE_SSRF_PROTECTION_DISABLED=true only in trusted self-hosted deployments.',
};

const normalizeRawRows = <T>(result: { rows?: T[] } | T[]): T[] => {
  if (Array.isArray(result)) {
    return result;
  }
  return result.rows ?? [];
};

export const maskDatabaseUrl = (url: string): string => {
  const parsed = new URL(url);
  if (parsed.password) {
    parsed.password = '***';
  }
  return parsed.toString();
};

export const fingerprintDatabaseUrl = (url: string): string => {
  return `dbfp_${createHash('sha256').update(url).digest('hex')}`;
};

export const getDatabaseUrlDisplayParts = (url: string) => {
  const parsed = new URL(url);
  return {
    displayHost: parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname,
    displayDatabase: parsed.pathname.replace(/^\//, ''),
  };
};

const isPrivateNetworkAllowed = () => process.env.TEABLE_SSRF_PROTECTION_DISABLED === 'true';

const isPrivateIp = (address: string): boolean => {
  if (address === '127.0.0.1' || address === '::1') {
    return true;
  }
  if (address.startsWith('10.') || address.startsWith('192.168.')) {
    return true;
  }
  if (address.startsWith('169.254.')) {
    return true;
  }
  const parts = address.split('.').map((part) => Number(part));
  if (parts.length === 4 && parts.every((part) => Number.isInteger(part))) {
    return parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31;
  }
  return address.toLowerCase().startsWith('fc') || address.toLowerCase().startsWith('fd');
};

export const dataDbKnexClientFactory: IDataDbPreflightClientFactory = (url) => {
  const client: Knex = createKnex({
    client: 'pg',
    connection: url,
    pool: { min: 0, max: 1 },
    acquireConnectionTimeout: 5000,
  });
  return {
    raw: async <T>(sql: string, bindings?: unknown[]) => {
      const result = bindings ? await client.raw(sql, bindings as never[]) : await client.raw(sql);
      return result as { rows?: T[] };
    },
    destroy: async () => client.destroy(),
  };
};

@Injectable()
export class DataDbPreflightService {
  private readonly clientFactory: IDataDbPreflightClientFactory;

  constructor(
    @Optional() private readonly prismaService?: PrismaService,
    @Optional()
    @Inject(DATA_DB_PREFLIGHT_CLIENT_FACTORY)
    clientFactory?: IDataDbPreflightClientFactory
  ) {
    this.clientFactory = clientFactory ?? dataDbKnexClientFactory;
  }

  async preflight(input: IDataDbPreflightRo): Promise<IDataDbPreflightVo> {
    const errors: IPreflightError[] = [];
    let maskedUrl: string | undefined;
    let urlFingerprint: string | undefined;
    let displayHost: string | undefined;
    let displayDatabase: string | undefined;

    try {
      parseDsn(input.url);
      maskedUrl = maskDatabaseUrl(input.url);
      urlFingerprint = fingerprintDatabaseUrl(input.url);
      const displayParts = getDatabaseUrlDisplayParts(input.url);
      displayHost = displayParts.displayHost;
      displayDatabase = displayParts.displayDatabase;
    } catch (error) {
      return this.buildResult({
        errors: [
          {
            code: 'INVALID_DATABASE_URL',
            message:
              error instanceof Error
                ? error.message.replace(input.url, '[redacted]')
                : 'Invalid URL',
          },
        ],
        classification: 'non-empty-unknown',
      });
    }

    const privateNetworkError = await this.validateNetwork(input.url);
    if (privateNetworkError) {
      errors.push(privateNetworkError);
      return this.buildResult({
        errors,
        maskedUrl,
        urlFingerprint,
        displayHost,
        displayDatabase,
        classification: 'non-empty-unknown',
      });
    }

    const client = this.clientFactory(input.url);
    try {
      const serverVersion = await this.getServerVersion(client);
      const capabilities = await this.detectCapabilities(client, errors);
      const classification = await this.classifyTarget(client, errors);

      return this.buildResult({
        errors,
        maskedUrl,
        urlFingerprint,
        displayHost,
        displayDatabase,
        serverVersion,
        capabilities,
        classification,
      });
    } catch (error) {
      errors.push({
        code: 'CONNECTION_FAILED',
        message: this.sanitizeErrorMessage(error, input.url),
        remediation: 'Verify host, port, database name, credentials, and SSL settings.',
      });
      return this.buildResult({
        errors,
        maskedUrl,
        urlFingerprint,
        displayHost,
        displayDatabase,
        classification: 'non-empty-unknown',
      });
    } finally {
      await client.destroy().catch(() => undefined);
    }
  }

  async getSummary(spaceId: string): Promise<IDataDbConnectionSummaryVo> {
    if (this.prismaService) {
      const binding = await this.prismaService.spaceDataDbBinding.findUnique({
        where: { spaceId },
        include: { dataDbConnection: true },
      });
      if (binding?.mode === 'byodb' && binding.dataDbConnection) {
        return {
          mode: binding.mode,
          state: binding.state,
          provider: binding.dataDbConnection.provider,
          displayHost: binding.dataDbConnection.displayHost ?? undefined,
          displayDatabase: binding.dataDbConnection.displayDatabase ?? undefined,
          lastValidatedAt: binding.dataDbConnection.lastValidatedAt?.toISOString(),
          lastError: binding.dataDbConnection.lastError ?? undefined,
          capabilities: binding.dataDbConnection.capabilities as
            | IDataDbConnectionSummaryVo['capabilities']
            | undefined,
        };
      }
    }
    return {
      mode: 'default',
      state: 'ready',
    };
  }

  private buildResult({
    errors,
    maskedUrl,
    urlFingerprint,
    displayHost,
    displayDatabase,
    serverVersion,
    capabilities = DEFAULT_CAPABILITIES,
    classification,
  }: {
    errors: IPreflightError[];
    maskedUrl?: string;
    urlFingerprint?: string;
    displayHost?: string;
    displayDatabase?: string;
    serverVersion?: string;
    capabilities?: IPreflightCapabilities;
    classification: IPreflightClassification;
  }): IDataDbPreflightVo {
    return {
      ok: errors.length === 0 && classification === 'empty',
      provider: 'postgres',
      maskedUrl,
      urlFingerprint,
      displayHost,
      displayDatabase,
      serverVersion,
      classification,
      capabilities,
      errors,
    };
  }

  private sanitizeErrorMessage(error: unknown, rawUrl: string) {
    const message = error instanceof Error ? error.message : String(error);
    const withoutRawUrl = rawUrl ? message.replace(rawUrl, '[redacted]') : message;
    return withoutRawUrl.replace(/:[^:@/]+@/g, ':***@');
  }

  private async validateNetwork(url: string): Promise<IPreflightError | null> {
    if (isPrivateNetworkAllowed()) {
      return null;
    }

    const { hostname } = new URL(url);
    const addresses = isIP(hostname)
      ? [{ address: hostname }]
      : await dns.lookup(hostname, { all: true }).catch(() => []);

    if (addresses.some(({ address }) => isPrivateIp(address))) {
      return PRIVATE_NETWORK_ERROR;
    }
    return null;
  }

  private async getServerVersion(client: IDataDbPreflightClient) {
    const rows = normalizeRawRows<{ server_version: string }>(
      await client.raw('SHOW server_version')
    );
    return rows[0]?.server_version;
  }

  private async detectCapabilities(
    client: IDataDbPreflightClient,
    errors: IPreflightError[]
  ): Promise<IPreflightCapabilities> {
    const capabilities = { ...DEFAULT_CAPABILITIES };

    try {
      const rows = normalizeRawRows<{ can_create: boolean }>(
        await client.raw(
          `SELECT has_database_privilege(current_database(), 'CREATE') AS can_create`
        )
      );
      capabilities.grantPrivileges = Boolean(rows[0]?.can_create);
    } catch (error) {
      errors.push({
        code: 'PRIVILEGE_CHECK_FAILED',
        message: this.sanitizeErrorMessage(error, ''),
      });
    }

    const schemaName = `__teable_byodb_preflight_${Date.now()}`;
    try {
      await client.raw(`CREATE SCHEMA "${schemaName}"`);
      capabilities.createSchema = true;
      await client.raw(`CREATE TABLE "${schemaName}"."check_table" ("id" text PRIMARY KEY)`);
      capabilities.createTable = true;
      await client.raw(`CREATE INDEX "check_table_id_idx" ON "${schemaName}"."check_table" ("id")`);
      await client.raw(`
        CREATE OR REPLACE FUNCTION "${schemaName}"."check_trigger_fn"()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
          RETURN NEW;
        END;
        $$;
      `);
      capabilities.createFunction = true;
      await client.raw(`
        CREATE TRIGGER "check_trigger"
        BEFORE INSERT ON "${schemaName}"."check_table"
        FOR EACH ROW
        EXECUTE FUNCTION "${schemaName}"."check_trigger_fn"();
      `);
      capabilities.createTrigger = true;
    } catch (error) {
      errors.push({
        code: 'DDL_PRIVILEGE_CHECK_FAILED',
        message: this.sanitizeErrorMessage(error, ''),
        remediation:
          'Grant CREATE privileges required for schemas, tables, functions, and triggers.',
      });
    } finally {
      await client.raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`).catch(() => undefined);
    }

    try {
      const rows = normalizeRawRows<{ can_create_role: boolean }>(
        await client.raw(
          `SELECT rolsuper OR rolcreaterole AS can_create_role FROM pg_roles WHERE rolname = current_user`
        )
      );
      capabilities.createRole = Boolean(rows[0]?.can_create_role);
    } catch {
      capabilities.createRole = false;
    }

    try {
      await client.raw(`SELECT COUNT(*) FROM pg_stat_activity WHERE usename = current_user`);
      capabilities.inspectActivity = true;
    } catch {
      capabilities.inspectActivity = false;
    }

    return capabilities;
  }

  private async classifyTarget(
    client: IDataDbPreflightClient,
    errors: IPreflightError[]
  ): Promise<IPreflightClassification> {
    const [schemaRows, tableRows, functionRows] = await Promise.all([
      client.raw<{ schema_name: string }>(`
        SELECT schema_name
        FROM information_schema.schemata
        WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
          AND schema_name NOT LIKE 'pg_%'
      `),
      client.raw<{ table_schema: string; table_name: string }>(`
        SELECT table_schema, table_name
        FROM information_schema.tables
        WHERE table_type = 'BASE TABLE'
          AND table_schema NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
          AND table_schema NOT LIKE 'pg_%'
      `),
      client.raw<{ routine_name: string }>(`
        SELECT routine_name
        FROM information_schema.routines
        WHERE routine_schema = 'public'
      `),
    ]);

    const schemas = normalizeRawRows(schemaRows).map((row) => row.schema_name);
    const tables = normalizeRawRows(tableRows);
    const functions = normalizeRawRows(functionRows).map((row) => row.routine_name);
    const bseSchemas = schemas.filter((schema) => schema.startsWith('bse'));
    const publicTables = tables
      .filter((table) => table.table_schema === 'public')
      .map((table) => table.table_name);
    const unknownTables = tables.filter((table) => {
      if (table.table_schema.startsWith('bse')) {
        return false;
      }
      return table.table_schema !== 'public' || !ALLOWED_PUBLIC_TABLES.has(table.table_name);
    });
    const managedTables = publicTables.filter((table) => DATA_PLANE_TABLES.includes(table));
    const managedFunctions = functions.filter((name) => DATA_PLANE_FUNCTIONS.includes(name));
    const hasManagedObjects =
      bseSchemas.length > 0 || managedTables.length > 0 || managedFunctions.length > 0;
    const hasAllBaselineObjects =
      DATA_PLANE_TABLES.every((table) => managedTables.includes(table)) &&
      DATA_PLANE_FUNCTIONS.every((func) => managedFunctions.includes(func));

    if (!hasManagedObjects && unknownTables.length === 0) {
      return 'empty';
    }

    if (unknownTables.length > 0) {
      errors.push({
        code: 'NON_EMPTY_UNKNOWN_DATABASE',
        message: 'The target database contains objects that are not managed by Teable',
        remediation: 'Use an empty database or run a dedicated migration/adopt flow.',
      });
      return 'non-empty-unknown';
    }

    if (hasAllBaselineObjects) {
      return 'teable-managed-compatible';
    }

    errors.push({
      code: 'INCOMPATIBLE_TEABLE_DATABASE',
      message: 'The target database contains partial Teable data-plane objects',
      remediation: 'Use a clean database or a compatible Teable data database manifest.',
    });
    return 'teable-managed-incompatible';
  }
}
