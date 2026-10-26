import { v2DataDbTokens } from '@teable/v2-adapter-db-postgres-shared';
import {
  ActorId,
  ListBasesQuery,
  ListTableRecordsQuery,
  ListTablesQuery,
  NoopRealtimeEngine,
  v2CoreTokens,
  type ListBasesResult,
  type ListTableRecordsResult,
  type ListTablesResult,
} from '@teable/v2-core';
import { Lifecycle } from '@teable/v2-di';
import { DotTeaParser } from '@teable/v2-dottea';
import { createHeadlessRuntime, type IHeadlessRuntime } from '@teable/v2-headless-runtime';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { sql, type Kysely } from 'kysely';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { buildAppBundle, readAppBundle, type IBuildAppBundleInput } from './bundle';
import { checksumSection, sha256Hex } from './checksums';
import { AppBundleError } from './errors';
import { installAppBundle } from './install';
import { appBundleStructureSchema } from './schema';

const unwrap = <T, E>(result: Result<T, E>): T => {
  if (result.isErr()) {
    throw new Error(String(result.error));
  }
  return result.value;
};

const sourceBaseId = `bse${'a'.repeat(16)}`;
const sourceTableId = `tbl${'b'.repeat(16)}`;
const sourceFieldId = `fld${'c'.repeat(16)}`;
const sourceViewId = `viw${'d'.repeat(16)}`;
const structurePath = 'structure.json';
const createdAt = '2026-10-23T00:00:00.000Z';

const structure = {
  id: sourceBaseId,
  tables: [
    {
      id: sourceTableId,
      name: 'Products',
      fields: [{ id: sourceFieldId, name: 'Name', type: 'singleLineText', isPrimary: true }],
      views: [{ id: sourceViewId, type: 'grid', name: 'Grid' }],
    },
  ],
};

const seed = {
  [sourceTableId]: [{ fields: { [sourceFieldId]: 'Widget' } }],
};

const relationStructure = {
  tables: [
    {
      id: 'tblCustomers',
      name: 'Customers',
      fields: [
        { id: 'fldCustomerName', name: 'Name', type: 'singleLineText', isPrimary: true },
        {
          id: 'fldOrders',
          name: 'Orders',
          type: 'link',
          options: {
            relationship: 'manyMany',
            foreignTableId: 'tblOrders',
            lookupFieldId: 'fldOrderName',
            isOneWay: true,
          },
        },
        {
          id: 'fldOrderTotal',
          name: 'Order Total',
          type: 'rollup',
          cellValueType: 'number',
          options: { expression: 'sum({values})' },
          lookupOptions: {
            linkFieldId: 'fldOrders',
            foreignTableId: 'tblOrders',
            lookupFieldId: 'fldAmount',
          },
        },
      ],
      views: [{ type: 'grid', name: 'Grid' }],
    },
    {
      id: 'tblOrders',
      name: 'Orders',
      fields: [
        { id: 'fldOrderName', name: 'Order', type: 'singleLineText', isPrimary: true },
        { id: 'fldAmount', name: 'Amount', type: 'number' },
        {
          id: 'fldCustomer',
          name: 'Customer',
          type: 'link',
          options: {
            relationship: 'manyOne',
            foreignTableId: 'tblCustomers',
            lookupFieldId: 'fldCustomerName',
            isOneWay: true,
          },
        },
        {
          id: 'fldCustomerNameLookup',
          name: 'Customer Name',
          type: 'lookup',
          lookupOptions: {
            linkFieldId: 'fldCustomer',
            foreignTableId: 'tblCustomers',
            lookupFieldId: 'fldCustomerName',
          },
        },
      ],
      views: [{ type: 'grid', name: 'Grid' }],
    },
  ],
};

/**
 * Same relations declared in the SDK/HTTP field DTO shape: the link carries
 * only `lookupOptions`, the lookup only `options`, and the rollup `config`.
 */
const sdkShapedStructure = {
  tables: [
    {
      id: 'tblCustomers',
      name: 'Customers',
      fields: [
        { id: 'fldCustomerName', name: 'Name', type: 'singleLineText', isPrimary: true },
        {
          id: 'fldOrders',
          name: 'Orders',
          type: 'link',
          lookupOptions: { foreignTableId: 'tblOrders', lookupFieldId: 'fldOrderName' },
        },
        {
          id: 'fldOrderTotal',
          name: 'Order Total',
          type: 'rollup',
          cellValueType: 'number',
          options: { expression: 'sum({values})' },
          config: {
            linkFieldId: 'fldOrders',
            foreignTableId: 'tblOrders',
            lookupFieldId: 'fldAmount',
          },
        },
      ],
      views: [{ type: 'grid', name: 'Grid' }],
    },
    {
      id: 'tblOrders',
      name: 'Orders',
      fields: [
        { id: 'fldOrderName', name: 'Order', type: 'singleLineText', isPrimary: true },
        { id: 'fldAmount', name: 'Amount', type: 'number' },
        {
          id: 'fldCustomer',
          name: 'Customer',
          type: 'link',
          options: {
            relationship: 'manyOne',
            foreignTableId: 'tblCustomers',
            lookupFieldId: 'fldCustomerName',
            isOneWay: true,
          },
        },
        {
          id: 'fldCustomerNameLookup',
          name: 'Customer Name',
          type: 'lookup',
          options: {
            linkFieldId: 'fldCustomer',
            foreignTableId: 'tblCustomers',
            lookupFieldId: 'fldCustomerName',
          },
        },
      ],
      views: [{ type: 'grid', name: 'Grid' }],
    },
  ],
};

const collectStructureIssues = (candidate: unknown): string[] => {
  const parsed = appBundleStructureSchema.safeParse(candidate);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
};

const migrationsAt = (schemaVersion: number, sqlText: string): Record<number, string> => ({
  [schemaVersion]: sqlText,
});

const baseInput: IBuildAppBundleInput = {
  appId: 'app_demo',
  name: 'Demo app',
  version: '1.0.0',
  schemaVersion: 1,
  createdAt,
  structure,
};

const actorContext = () => ({ actorId: unwrap(ActorId.create('usr_app')) });

const registerDotTeaParser = (runtime: IHeadlessRuntime): void => {
  runtime.container.register(v2CoreTokens.dotTeaParser, DotTeaParser, {
    lifecycle: Lifecycle.Singleton,
  });
};

const withRuntime = async (run: (runtime: IHeadlessRuntime) => Promise<void>): Promise<void> => {
  const runtime = await createHeadlessRuntime({
    backend: { kind: 'pglite', dataDir: 'memory://' },
  });
  try {
    registerDotTeaParser(runtime);
    await run(runtime);
  } finally {
    await runtime.close();
  }
};

const listInstalledRecords = async (runtime: IHeadlessRuntime, tableId: string) =>
  unwrap(
    await runtime.queryBus.execute<ListTableRecordsQuery, ListTableRecordsResult>(
      actorContext(),
      unwrap(ListTableRecordsQuery.create({ tableId, fieldKeyType: 'id' }))
    )
  );

const listInstalledTables = async (runtime: IHeadlessRuntime, baseId: string) =>
  unwrap(
    await runtime.queryBus.execute<ListTablesQuery, ListTablesResult>(
      actorContext(),
      unwrap(ListTablesQuery.create({ baseId }))
    )
  );

const readInstallRow = async (runtime: IHeadlessRuntime, appId: string) => {
  const db = runtime.container.resolve<Kysely<unknown>>(v2DataDbTokens.db);
  const result = await sql<{
    baseId: string;
    version: string;
    schemaVersion: number;
    checksum: string;
  }>`
    select base_id as "baseId",
           version,
           schema_version as "schemaVersion",
           checksum
    from public.app_bundle_install
    where app_id = ${appId}
  `.execute(db);
  return result.rows[0];
};

interface ITestField {
  id?: string;
  name?: string;
  type: string;
  [key: string]: unknown;
}

interface ITestView {
  id?: string;
  name?: string;
  type?: string;
  [key: string]: unknown;
}

interface ITestTable {
  id: string;
  name: string;
  fields: ITestField[];
  views?: ITestView[];
  [key: string]: unknown;
}

interface ITestStructure {
  id?: string;
  tables: ITestTable[];
  [key: string]: unknown;
}

/**
 * Valid CRM bundle: Customers links to Orders, Orders looks up the customer
 * name, and Customers rolls up order amounts through its own Orders link.
 */
const crmStructure: ITestStructure = {
  tables: [
    {
      id: 'tblCrmCustomers',
      name: 'Customers',
      fields: [
        { id: 'fldCustName', name: 'Name', type: 'singleLineText', isPrimary: true },
        {
          id: 'fldCustOrders',
          name: 'Orders',
          type: 'link',
          options: {
            relationship: 'manyMany',
            foreignTableId: 'tblCrmOrders',
            lookupFieldId: 'fldOrderName',
            isOneWay: true,
          },
        },
        {
          id: 'fldWonAmount',
          name: 'Won Amount',
          type: 'rollup',
          cellValueType: 'number',
          options: { expression: 'sum({values})' },
          lookupOptions: {
            linkFieldId: 'fldCustOrders',
            foreignTableId: 'tblCrmOrders',
            lookupFieldId: 'fldOrderAmount',
          },
        },
      ],
      views: [{ type: 'grid', name: 'Grid' }],
    },
    {
      id: 'tblCrmOrders',
      name: 'Orders',
      fields: [
        { id: 'fldOrderName', name: 'Order', type: 'singleLineText', isPrimary: true },
        { id: 'fldOrderAmount', name: 'Amount', type: 'number' },
        {
          id: 'fldOrderCustomer',
          name: 'Customer',
          type: 'link',
          options: {
            relationship: 'manyOne',
            foreignTableId: 'tblCrmCustomers',
            lookupFieldId: 'fldCustName',
            isOneWay: true,
          },
        },
        {
          id: 'fldCustomerName',
          name: 'Customer Name',
          type: 'lookup',
          lookupOptions: {
            linkFieldId: 'fldOrderCustomer',
            foreignTableId: 'tblCrmCustomers',
            lookupFieldId: 'fldCustName',
          },
        },
      ],
      views: [{ type: 'grid', name: 'Grid' }],
    },
  ],
};

const cloneCrm = (): ITestStructure => structuredClone(crmStructure);

const buildRawBundle = (candidate: unknown): Uint8Array => {
  const structureBytes = strToU8(JSON.stringify(candidate));
  const files: Record<string, Uint8Array> = {};
  files['manifest.json'] = strToU8(
    JSON.stringify({
      formatVersion: 1,
      appId: 'app_raw',
      name: 'Raw bundle',
      version: '1.0.0',
      schemaVersion: 1,
      createdAt,
      checksums: {
        structure: sha256Hex(structureBytes),
        seed: checksumSection([]),
        migrations: checksumSection([]),
      },
    })
  );
  files['structure.json'] = structureBytes;
  return zipSync(files);
};

const expectStructureRejected = async (
  candidate: ITestStructure,
  fragment: string
): Promise<void> => {
  await expect(buildAppBundle({ ...baseInput, structure: candidate })).rejects.toMatchObject({
    code: 'bundle.invalid_structure',
    message: expect.stringContaining(fragment),
  });
  await expect(readAppBundle(buildRawBundle(candidate))).rejects.toMatchObject({
    code: 'bundle.invalid_structure',
    message: expect.stringContaining(fragment),
  });
};
describe('@teable/v2-app-bundle', () => {
  it('builds a bundle and reads it back with verified checksums', async () => {
    const bytes = await buildAppBundle({
      ...baseInput,
      schemaVersion: 2,
      seed,
      migrations: migrationsAt(2, 'select 1;\nselect 2;'),
    });

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);

    const archive = unzipSync(bytes);
    expect(Object.keys(archive).sort()).toEqual(
      ['manifest.json', 'migrations/2.sql', `seed/${sourceTableId}.json`, structurePath].sort()
    );

    const contents = await readAppBundle(bytes);
    expect(contents.manifest).toMatchObject({
      formatVersion: 1,
      appId: 'app_demo',
      name: 'Demo app',
      version: '1.0.0',
      schemaVersion: 2,
      createdAt,
    });
    expect(contents.structure).toEqual(structure);
    expect(contents.seed).toEqual([{ tableId: sourceTableId, records: seed[sourceTableId] }]);
    expect(contents.migrations).toEqual([{ schemaVersion: 2, sql: 'select 1;\nselect 2;' }]);

    expect(contents.checksums).toEqual(contents.manifest.checksums);
    expect(contents.manifest.checksums.structure).toBe(
      sha256Hex(strToU8(JSON.stringify(structure)))
    );
    expect(contents.manifest.checksums.seed).toBe(
      checksumSection([
        {
          path: `seed/${sourceTableId}.json`,
          bytes: strToU8(JSON.stringify(seed[sourceTableId])),
        },
      ])
    );
    expect(contents.manifest.checksums.migrations).toBe(
      checksumSection([{ path: 'migrations/2.sql', bytes: strToU8('select 1;\nselect 2;') }])
    );
  });

  it('installs a bundle and exposes its table and seeded record', async () => {
    const bytes = await buildAppBundle({ ...baseInput, seed });

    await withRuntime(async (runtime) => {
      const installed = await installAppBundle(runtime, bytes, {
        actorId: 'usr_app',
        baseName: 'Installed app',
      });

      expect(installed.appId).toBe('app_demo');
      expect(installed.version).toBe('1.0.0');
      expect(installed.schemaVersion).toBe(1);
      expect(installed.baseId).toMatch(/^bse/);
      expect(installed.tables).toEqual([{ id: expect.stringMatching(/^tbl/), name: 'Products' }]);

      const tables = await listInstalledTables(runtime, installed.baseId);
      expect(tables.tables.map((table) => table.name().toString())).toEqual(['Products']);

      const records = await listInstalledRecords(runtime, installed.tables[0]!.id);
      expect(records.records).toHaveLength(1);
      expect(Object.values(records.records[0]!.fields)).toEqual(['Widget']);

      const installRow = await readInstallRow(runtime, 'app_demo');
      expect(installRow).toMatchObject({
        baseId: installed.baseId,
        version: '1.0.0',
        schemaVersion: 1,
      });
    });
  }, 30_000);

  it('is idempotent for the same version and rejects the same version with different content', async () => {
    const bytes = await buildAppBundle({ ...baseInput, seed });

    await withRuntime(async (runtime) => {
      const first = await installAppBundle(runtime, bytes, { actorId: 'usr_app' });
      const second = await installAppBundle(runtime, bytes, { actorId: 'usr_app' });

      expect(second.baseId).toBe(first.baseId);
      expect(second.tables).toEqual(first.tables);

      const records = await listInstalledRecords(runtime, second.tables[0]!.id);
      expect(records.records).toHaveLength(1);

      const changed = await buildAppBundle({
        ...baseInput,
        seed: { [sourceTableId]: [{ fields: { [sourceFieldId]: 'Different' } }] },
      });
      await expect(
        installAppBundle(runtime, changed, { actorId: 'usr_app' })
      ).rejects.toMatchObject({ code: 'install.version_conflict' });
    });
  }, 30_000);

  it('applies higher schemaVersion migrations and updates the install record', async () => {
    const first = await buildAppBundle({ ...baseInput, seed });
    const upgrade = await buildAppBundle({
      ...baseInput,
      version: '1.1.0',
      schemaVersion: 2,
      seed,
      migrations: migrationsAt(
        2,
        [
          'create table if not exists public.app_bundle_marker (',
          '  id integer primary key,',
          "  note text not null default 'pending'",
          ');',
          "insert into public.app_bundle_marker (id, note) values (1, 'upgraded');",
        ].join('\n')
      ),
    });

    await withRuntime(async (runtime) => {
      const installed = await installAppBundle(runtime, first, { actorId: 'usr_app' });
      const upgraded = await installAppBundle(runtime, upgrade, { actorId: 'usr_app' });

      expect(upgraded.baseId).toBe(installed.baseId);
      expect(upgraded.version).toBe('1.1.0');
      expect(upgraded.schemaVersion).toBe(2);
      expect(upgraded.tables).toEqual(installed.tables);

      const db = runtime.container.resolve<Kysely<unknown>>(v2DataDbTokens.db);
      const markers = await sql<{ id: number; note: string }>`
        select id, note from public.app_bundle_marker
      `.execute(db);
      expect(markers.rows).toEqual([{ id: 1, note: 'upgraded' }]);

      const installRow = await readInstallRow(runtime, 'app_demo');
      expect(installRow).toMatchObject({
        baseId: installed.baseId,
        version: '1.1.0',
        schemaVersion: 2,
      });
      expect(installRow?.checksum).toHaveLength(64);
    });
  }, 30_000);

  it('rejects a lower schemaVersion', async () => {
    const first = await buildAppBundle({ ...baseInput, seed });
    const second = await buildAppBundle({
      ...baseInput,
      version: '1.1.0',
      schemaVersion: 2,
      seed,
      migrations: migrationsAt(2, 'select 1;'),
    });
    const older = await buildAppBundle({
      ...baseInput,
      version: '0.9.0',
      schemaVersion: 1,
      seed,
    });

    await withRuntime(async (runtime) => {
      await installAppBundle(runtime, first, { actorId: 'usr_app' });
      await installAppBundle(runtime, second, { actorId: 'usr_app' });

      await expect(installAppBundle(runtime, older, { actorId: 'usr_app' })).rejects.toMatchObject({
        code: 'install.schema_downgrade',
      });
    });
  }, 30_000);

  it('rejects a tampered structure', async () => {
    const bytes = await buildAppBundle({ ...baseInput, seed });
    const archive = unzipSync(bytes);
    const tamperedStructure = strToU8(
      JSON.stringify({ ...structure, tables: [{ ...structure.tables[0], name: 'Tampered' }] })
    );
    const tampered = zipSync({ ...archive, [structurePath]: tamperedStructure });

    await expect(readAppBundle(tampered)).rejects.toBeInstanceOf(AppBundleError);
    await expect(readAppBundle(tampered)).rejects.toMatchObject({
      code: 'bundle.checksum_mismatch',
    });

    const reparsedManifest = JSON.parse(strFromU8(archive['manifest.json']!)) as {
      checksums: { structure: string };
    };
    expect(reparsedManifest.checksums.structure).not.toBe(sha256Hex(tamperedStructure));
  });

  it('installs link, lookup, and rollup fields declared in the DotTea shape', async () => {
    const bytes = await buildAppBundle({ ...baseInput, structure: relationStructure });

    await withRuntime(async (runtime) => {
      const installed = await installAppBundle(runtime, bytes, { actorId: 'usr_app' });
      expect(installed.tables.map((table) => table.name)).toEqual(['Customers', 'Orders']);

      const tables = await listInstalledTables(runtime, installed.baseId);
      const fieldsOf = (tableName: string) =>
        tables.tables
          .find((table) => table.name().toString() === tableName)!
          .getFields()
          .map((field) => [field.name().toString(), field.type().toString()]);

      expect(fieldsOf('Customers')).toEqual(
        expect.arrayContaining([
          ['Name', 'singleLineText'],
          ['Orders', 'link'],
          ['Order Total', 'rollup'],
        ])
      );
      expect(fieldsOf('Orders')).toEqual(
        expect.arrayContaining([
          ['Order', 'singleLineText'],
          ['Amount', 'number'],
          ['Customer', 'link'],
          ['Customer Name', 'lookup'],
        ])
      );
    });
  }, 30_000);

  it('rejects link, lookup, and rollup fields declared in the SDK DTO shape', async () => {
    const issues = await collectStructureIssues(sdkShapedStructure);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.stringContaining('"Order Total"'),
        expect.stringContaining('lookupOptions.foreignTableId'),
        expect.stringContaining('"Customer Name"'),
        expect.stringContaining('lookupOptions.linkFieldId'),
        expect.stringContaining('"Orders"'),
        expect.stringContaining('options.relationship'),
      ])
    );

    await expect(
      buildAppBundle({ ...baseInput, structure: sdkShapedStructure })
    ).rejects.toMatchObject({
      code: 'bundle.invalid_structure',
      message: expect.stringContaining('singleLineText'),
    });
  });

  it('rejects an externally built bundle whose structure uses the SDK DTO shape', async () => {
    const structureBytes = strToU8(JSON.stringify(sdkShapedStructure));
    const files: Record<string, Uint8Array> = {};
    files['manifest.json'] = strToU8(
      JSON.stringify({
        formatVersion: 1,
        appId: 'app_sdk_shape',
        name: 'SDK shape',
        version: '1.0.0',
        schemaVersion: 1,
        createdAt,
        checksums: {
          structure: sha256Hex(structureBytes),
          seed: checksumSection([]),
          migrations: checksumSection([]),
        },
      })
    );
    files['structure.json'] = structureBytes;
    const bytes = zipSync(files);

    await expect(readAppBundle(bytes)).rejects.toMatchObject({
      code: 'bundle.invalid_structure',
      message: expect.stringContaining('lookupOptions.foreignTableId'),
    });
  });
  it('fails before creating a base when the host does not register a DotTea parser', async () => {
    const bytes = await buildAppBundle({ ...baseInput, seed });
    const runtime = await createHeadlessRuntime({
      backend: { kind: 'pglite', dataDir: 'memory://' },
      realtime: new NoopRealtimeEngine(),
    });

    try {
      await expect(installAppBundle(runtime, bytes, { actorId: 'usr_app' })).rejects.toMatchObject({
        code: 'install.dot_tea_parser_missing',
      });

      const bases = unwrap(
        await runtime.queryBus.execute<ListBasesQuery, ListBasesResult>(
          actorContext(),
          unwrap(ListBasesQuery.create({}))
        )
      );
      expect(bases.bases).toHaveLength(0);
    } finally {
      await runtime.close();
    }
  }, 30_000);
  it('accepts and installs a valid CRM structure with link, lookup, and rollup fields', async () => {
    const bytes = await buildAppBundle({ ...baseInput, structure: crmStructure });
    const contents = await readAppBundle(bytes);
    expect(contents.structure.tables.map((table) => table.name)).toEqual(['Customers', 'Orders']);

    await withRuntime(async (runtime) => {
      const installed = await installAppBundle(runtime, bytes, { actorId: 'usr_app' });
      expect(installed.tables.map((table) => table.name)).toEqual(['Customers', 'Orders']);
    });
  }, 30_000);

  it('rejects a field id duplicated across tables', async () => {
    const candidate = cloneCrm();
    candidate.tables[0]!.fields.push({
      id: 'fldOrderAmount',
      name: 'Won Amount 2',
      type: 'singleLineText',
    });

    await expectStructureRejected(
      candidate,
      'Duplicate field id "fldOrderAmount" across tables "Customers" and "Orders": ' +
        'field "Won Amount 2" and field "Amount" declare the same id'
    );
  });

  it('rejects a field id duplicated within one table', async () => {
    const candidate = cloneCrm();
    candidate.tables[1]!.fields.push({ id: 'fldOrderAmount', name: 'Amount 2', type: 'number' });

    await expectStructureRejected(
      candidate,
      'Duplicate field id "fldOrderAmount" in table "Orders": ' +
        'field "Amount" and field "Amount 2" declare the same id'
    );
  });

  it("rejects a lookup whose linkFieldId points at another table's link", async () => {
    const candidate = cloneCrm();
    candidate.tables[0]!.fields.push({
      id: 'fldBadLookup',
      name: 'Bad Lookup',
      type: 'lookup',
      lookupOptions: {
        linkFieldId: 'fldOrderCustomer',
        foreignTableId: 'tblCrmOrders',
        lookupFieldId: 'fldOrderName',
      },
    });

    await expectStructureRejected(
      candidate,
      'Lookup field "Bad Lookup" in table "Customers" references link field ' +
        '"fldOrderCustomer" which is not in the same table'
    );
  });

  it('rejects a rollup whose linkFieldId does not live on the host table', async () => {
    const candidate = cloneCrm();
    candidate.tables[1]!.fields.push({
      id: 'fldBadRollup',
      name: 'Bad Rollup',
      type: 'rollup',
      options: { expression: 'sum({values})' },
      lookupOptions: {
        linkFieldId: 'fldCustOrders',
        foreignTableId: 'tblCrmCustomers',
        lookupFieldId: 'fldCustName',
      },
    });

    await expectStructureRejected(
      candidate,
      'Rollup field "Bad Rollup" in table "Orders" references link field ' +
        '"fldCustOrders" which is not in the same table'
    );
  });

  it('rejects a link whose foreign table is not declared in the bundle', async () => {
    const candidate = cloneCrm();
    candidate.tables[1]!.fields.push({
      id: 'fldBadLink',
      name: 'Bad Link',
      type: 'link',
      options: {
        relationship: 'manyOne',
        foreignTableId: 'tblNowhere',
        lookupFieldId: 'fldCustName',
      },
    });

    await expectStructureRejected(
      candidate,
      'Link field "Bad Link" in table "Orders" references foreign table ' +
        '"tblNowhere" which is not declared in this bundle'
    );
  });
});
