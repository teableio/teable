import { createRouterClient } from '@orpc/server';
import {
  createV2NodeTestContainer,
  type IV2NodeTestContainer,
} from '@teable/v2-container-node-test';
import {
  ActorId,
  CreateRecordCommand,
  CreateTableCommand,
  UpdateRecordCommand,
  domainError,
  v2CoreTokens,
  type CreateRecordResult,
  type CreateTableResult,
  type ICommandBus,
  type IExecutionContext,
} from '@teable/v2-core';
import {
  registerV2VcsServerModule,
  v2VcsServerTokens,
  type IVcsAccessPolicy,
} from '@teable/v2-vcs/server';
import { err } from 'neverthrow';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createV2VcsOrpcRouter } from './vcsRouter';

const createContext = (actor = 'usr_vcs_router'): IExecutionContext => ({
  actorId: ActorId.create(actor)._unsafeUnwrap(),
});

describe('v2VcsContract oRPC router (real PostgreSQL)', () => {
  let testContainer: IV2NodeTestContainer;
  let commandBus: ICommandBus;

  beforeAll(async () => {
    testContainer = await createV2NodeTestContainer({ ensureSchema: true });
    commandBus = testContainer.container.resolve<ICommandBus>(v2CoreTokens.commandBus);
  }, 120_000);

  afterAll(async () => {
    await testContainer?.dispose();
  }, 30_000);

  it('serves head, clone, cursor-validated changes, push, 409 CAS conflict, and 403 policy denial', async () => {
    const ctx = createContext();
    const baseId = testContainer.baseId.toString();

    const tableRes = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      ctx,
      CreateTableCommand.create({
        baseId,
        name: 'RouterTasks',
        fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
      })._unsafeUnwrap()
    );
    const table = tableRes._unsafeUnwrap().table;
    const tableId = table.id().toString();
    const primaryFieldId = table.primaryFieldId().toString();

    const created = (
      await commandBus.execute<CreateRecordCommand, CreateRecordResult>(
        ctx,
        CreateRecordCommand.create({
          tableId,
          fields: { [primaryFieldId]: 'Initial Task' },
        })._unsafeUnwrap()
      )
    )._unsafeUnwrap().record;
    const recordId = created.id().toString();

    const client = createRouterClient(
      createV2VcsOrpcRouter({
        createContainer: () => testContainer.container,
        createExecutionContext: () => ctx,
      }),
      { context: {} }
    );

    const headBefore = await client.head({ baseId });
    expect(headBefore.baseId).toBe(baseId);
    expect(headBefore.remoteMode).toBe('v2-vcs');
    expect(headBefore.vcsEnabled).toBe(false);

    // GET /clone must remain read-only and never auto-enable VCS.
    const readonlyCloned = await client.clone({ baseId, tables: tableId });
    expect(readonlyCloned.remoteMode).toBe('openapi-readonly');
    expect(readonlyCloned.snapshot.cursor).toBeUndefined();
    const headAfterReadonlyClone = await client.head({ baseId });
    expect(headAfterReadonlyClone.vcsEnabled).toBe(false);

    // Explicit POST /enable activates VCS tracking at revision 0.
    const enabled = await client.enable({ baseId });
    expect(enabled).toEqual({
      baseId,
      enabled: true,
      headRevision: 0,
      enabledAtRevision: 0,
    });

    const headAfterEnable = await client.head({ baseId });
    expect(headAfterEnable.remoteMode).toBe('v2-vcs');
    expect(headAfterEnable.vcsEnabled).toBe(true);

    const cloned = await client.clone({ baseId, tables: tableId });
    expect(cloned.remoteMode).toBe('v2-vcs');
    expect(cloned.snapshot.cursor).toMatch(/^v2\|/);
    expect(cloned.snapshot.tables).toHaveLength(1);
    const cursor = cloned.snapshot.cursor!;

    // Streaming clone mode: includeRecords=false returns schema only, and cloneRecords paginates records.
    const schemaOnlyClone = await client.clone({
      baseId,
      tables: tableId,
      includeRecords: false,
    });
    expect(schemaOnlyClone.snapshot.tables).toHaveLength(1);
    expect(schemaOnlyClone.snapshot.tables[0]?.records).toHaveLength(0);
    const chunk = await client.cloneRecords({
      baseId,
      tableId,
      limit: 1,
    });
    expect(chunk.tableId).toBe(tableId);
    expect(chunk.records).toHaveLength(1);
    expect(chunk.records[0]?.id).toBe(recordId);

    // Missing or empty cursor is rejected cleanly at contract validation boundary.
    await expect(client.changes({ baseId, cursor: '   ' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });

    // Empty delta right after clone (must keep the same tableIds scope).
    const emptyChanges = await client.changes({
      baseId,
      cursor,
      since: cloned.snapshot.revision,
      tableIds: [tableId],
    });
    expect(emptyChanges.hasChanges).toBe(false);
    expect(emptyChanges.requiresFullSync).toBe(false);
    expect(emptyChanges.hasMore).toBe(false);
    expect(emptyChanges.nextCursor).toBeTruthy();

    // Widening scope from [tableId] -> all tables triggers requiresFullSync=true.
    const scopeWidened = await client.changes({
      baseId,
      cursor,
      since: cloned.snapshot.revision,
    });
    expect(scopeWidened.requiresFullSync).toBe(true);

    // Mutate record via v2 command bus -> incremental changes picks it up.
    (
      await commandBus.execute(
        ctx,
        UpdateRecordCommand.create({
          tableId,
          recordId,
          fields: { [primaryFieldId]: 'Updated Server Task' },
        })._unsafeUnwrap()
      )
    )._unsafeUnwrap();

    const nextChanges = await client.changes({
      baseId,
      cursor,
      since: cloned.snapshot.revision,
      tableIds: [tableId],
    });
    expect(nextChanges.hasChanges).toBe(true);
    expect(nextChanges.recordDeltas[0]?.upserts[0]?.fields[primaryFieldId]).toBe(
      'Updated Server Task'
    );

    // Push with stale before ('Initial Task' vs live 'Updated Server Task') -> 409 CONFLICT.
    await expect(
      client.push({
        baseId,
        baseRevision: cloned.snapshot.revision,
        patch: {
          tablesAdded: [],
          tablesDeleted: [],
          tablesUpdated: [
            {
              tableId,
              fieldsAdded: [],
              fieldsUpdated: [],
              fieldsDeleted: [],
              viewsAdded: [],
              viewsUpdated: [],
              viewsDeleted: [],
              recordsAdded: [],
              recordsUpdated: [
                {
                  recordId,
                  cellChanges: [
                    {
                      fieldId: primaryFieldId,
                      before: 'Initial Task',
                      after: 'Client Stale Write',
                    },
                  ],
                },
              ],
              recordsDeleted: [],
            },
          ],
        },
      })
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
      data: {
        domainCode: 'vcs.cas_conflict',
        domainTags: ['conflict'],
      },
    });

    // Clean push succeeds and advances headRevision.
    const pushed = await client.push({
      baseId,
      baseRevision: cloned.snapshot.revision,
      originPushId: 'vcsp_router_ok_1',
      patch: {
        tablesAdded: [],
        tablesDeleted: [],
        tablesUpdated: [
          {
            tableId,
            fieldsAdded: [],
            fieldsUpdated: [],
            fieldsDeleted: [],
            viewsAdded: [],
            viewsUpdated: [],
            viewsDeleted: [],
            recordsAdded: [],
            recordsUpdated: [
              {
                recordId,
                cellChanges: [
                  {
                    fieldId: primaryFieldId,
                    before: 'Updated Server Task',
                    after: 'Client Clean Write',
                  },
                ],
              },
            ],
            recordsDeleted: [],
          },
        ],
      },
    });
    expect(pushed.ok).toBe(true);
    expect(pushed.newRevision).toBe(cloned.snapshot.revision + 1);
    const historical = await client.checkout({ baseId, revision: pushed.newRevision });
    const historicalRecord = historical.snapshot.tables
      .find((table) => table.id === tableId)
      ?.records.find((record) => record.id === recordId);
    expect(historicalRecord?.fields[primaryFieldId]).toBe('Client Clean Write');

    // IVcsAccessPolicy denial on push maps to 403 FORBIDDEN.
    const realPolicy = testContainer.container.resolve<IVcsAccessPolicy>(
      v2VcsServerTokens.accessPolicy
    );
    const spyPolicy: IVcsAccessPolicy = {
      resolveReadableTables: realPolicy.resolveReadableTables.bind(realPolicy),
      assertCanEnableVcs: vi.fn(async () =>
        err(
          domainError.forbidden({
            code: 'vcs.forbidden_enable',
            message: 'Read-only caller cannot enable VCS',
          })
        )
      ),
      assertCanApplyPatch: vi.fn(async () =>
        err(
          domainError.forbidden({
            code: 'vcs.forbidden_write',
            message: 'Read-only caller cannot push',
          })
        )
      ),
    };
    const restrictedContainer = testContainer.container.createChildContainer();
    restrictedContainer.registerInstance(v2VcsServerTokens.accessPolicy, spyPolicy);
    registerV2VcsServerModule(restrictedContainer);

    const restrictedClient = createRouterClient(
      createV2VcsOrpcRouter({
        createContainer: () => restrictedContainer,
        createExecutionContext: () => ctx,
      }),
      { context: {} }
    );

    await expect(
      restrictedClient.checkout({ baseId, revision: pushed.newRevision })
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });

    await expect(restrictedClient.enable({ baseId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
      data: {
        domainCode: 'vcs.forbidden_enable',
        domainTags: ['forbidden'],
      },
    });

    await expect(
      restrictedClient.push({
        baseId,
        baseRevision: pushed.newRevision,
        patch: {
          tablesAdded: [],
          tablesDeleted: [],
          tablesUpdated: [
            {
              tableId,
              fieldsAdded: [],
              fieldsUpdated: [],
              fieldsDeleted: [],
              viewsAdded: [],
              viewsUpdated: [],
              viewsDeleted: [],
              recordsAdded: [{ id: 'recForbidden0000001', fields: { [primaryFieldId]: 'Denied' } }],
              recordsUpdated: [],
              recordsDeleted: [],
            },
          ],
        },
      })
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
      data: {
        domainCode: 'vcs.forbidden_write',
        domainTags: ['forbidden'],
      },
    });
  }, 60_000);
});
