import { createV2NodeTestContainer } from '@teable/v2-container-node-test';
import {
  ActorId,
  BaseId,
  FieldId,
  FieldName,
  ListTableRecordsQuery,
  Table,
  TableId,
  TableName,
  v2CoreTokens,
  type IExecutionContext,
  type IQueryBus,
  type IUnitOfWork,
} from '@teable/v2-core';
import {
  diffSnapshots,
  ok,
  summarizePatch,
  type IBaseVcsSnapshot,
  type ITableVcsSnapshot,
} from '@teable/v2-vcs';
import { BaseVcsHistoryService, encodeCheckpointTable } from '@teable/v2-vcs/server';
import { sql, type Kysely } from 'kysely';
import { expect, it, vi } from 'vitest';
import {
  PostgresBaseVcsLogRepository,
  type IBaseVcsDatabase,
} from './PostgresBaseVcsLogRepository';

it('checks changed rows and linked target IDs without loading a shared table or disclosing masked values', async () => {
  const container = await createV2NodeTestContainer({ ensureSchema: true });
  try {
    const db = container.dataDb as unknown as Kysely<IBaseVcsDatabase>;
    const uow = container.container.resolve<IUnitOfWork>(v2CoreTokens.unitOfWork);
    const repo = new PostgresBaseVcsLogRepository(db, uow);
    const base = BaseId.generate()._unsafeUnwrap();
    const ctx = { actorId: ActorId.create('usr_history_test')._unsafeUnwrap() };
    const id = (kind: string, char: string) => kind + char.repeat(16);
    const title = id('fld', 'a');
    const link = id('fld', 'b');
    const secret = id('fld', 'c');
    const targetTitle = id('fld', 'd');
    const changed = id('rec', 'a');
    const visible = id('rec', 'b');
    const hidden = id('rec', 'c');
    const targets: ITableVcsSnapshot = {
      id: id('tbl', 'b'),
      name: 'Targets',
      primaryFieldId: targetTitle,
      fields: [
        {
          id: targetTitle,
          name: 'Label',
          type: 'singleLineText',
          isPrimary: true,
          isComputed: false,
        },
      ],
      views: [],
      records: [visible, hidden].map((row) => ({
        id: row,
        fields: { [targetTitle]: 'withheld title' },
      })),
    };
    const unrelated = { ...targets, id: id('tbl', 'u'), name: 'Unchanged' };
    const snapshot = (revision: number): IBaseVcsSnapshot => ({
      baseId: base.toString(),
      baseName: 'Inventory',
      revision,
      capturedAt: '2026-11-01T00:00:00Z',
      formatVersion: 1,
      tables: [
        {
          id: id('tbl', 'a'),
          name: 'Items',
          primaryFieldId: title,
          fields: [
            {
              id: title,
              name: 'Title',
              type: 'singleLineText',
              isPrimary: true,
              isComputed: false,
            },
            {
              id: link,
              name: 'Related',
              type: 'link',
              isPrimary: false,
              isComputed: false,
              options: { foreignTableId: targets.id },
            },
            { id: secret, name: 'Budget', type: 'number', isPrimary: false, isComputed: false },
          ],
          views: [],
          records: [
            {
              id: changed,
              fields: {
                [title]: `Public ${revision}`,
                [secret]: revision + 10000,
                [link]: [{ id: revision ? visible : hidden, title: 'withheld title' }],
              },
            },
            { id: id('rec', 'z'), fields: { [title]: 'untouched' } },
          ],
        },
        targets,
        unrelated,
      ],
    });
    const left = snapshot(0);
    const right = snapshot(1);
    (await repo.enable(ctx, base, async () => ok(left)))._unsafeUnwrap();
    (
      await uow.withTransaction(
        ctx,
        (tx) =>
          repo.appendCommit(
            tx,
            base,
            {
              actorId: ctx.actorId.toString(),
              expectedHeadRevision: 0,
              originPushId: 'scoped-diff',
              summary: summarizePatch(diffSnapshots(left, right)),
            },
            async () => ok(right)
          ),
        { scope: 'data', isolationLevel: 'serializable' }
      )
    )._unsafeUnwrap();
    // A full read of either endpoint would now fail. The unchanged link target still exists.
    await sql`DELETE FROM base_vcs_object WHERE base_id = ${base.toString()} AND hash = ${encodeCheckpointTable(unrelated).hash}`.execute(
      db
    );
    const scopes = left.tables.map((table) => {
      const builder = Table.builder()
        .withBaseId(base)
        .withId(TableId.create(table.id)._unsafeUnwrap())
        .withName(TableName.create(table.name)._unsafeUnwrap());
      for (const field of table.fields) {
        const f = builder
          .field()
          .singleLineText()
          .withId(FieldId.create(field.id)._unsafeUnwrap())
          .withName(FieldName.create(field.name)._unsafeUnwrap());
        if (field.isPrimary) f.primary();
        f.done();
      }
      builder.view().defaultGrid().done();
      return {
        tableId: table.id,
        table: builder.build()._unsafeUnwrap(),
        readableViewIds: new Set<string>(),
      };
    });
    const inspected = new Set<string>();
    const queries = {
      execute: async (_ctx: IExecutionContext, query: ListTableRecordsQuery) => {
        const selected = query.selectedRecordIds ?? [];
        for (const row of selected) inspected.add(row);
        return ok({
          records: selected
            .filter((row) => row !== hidden)
            .map((row) => ({
              id: row,
              fields: row === changed ? { [title]: '', [link]: [] } : { [targetTitle]: '' },
            })),
          hasMore: false,
        });
      },
    } as unknown as IQueryBus;
    const service = new BaseVcsHistoryService(
      repo,
      {
        resolveHistoryAccess: async () => ok({ kind: 'scoped', tables: scopes }),
        assertCanApplyPatch: vi.fn(),
      },
      queries,
      { capture: vi.fn() },
      { withBatchTransaction: vi.fn() },
      { execute: vi.fn(), prepareRollbackOrderColumns: vi.fn(), withWriteCoordination: vi.fn() },
      { find: vi.fn() }
    );
    const result = (
      await service.diff(ctx, { baseId: base.toString(), from: 0, to: 1 })
    )._unsafeUnwrap();
    expect(inspected).toEqual(new Set([changed, visible, hidden]));
    expect(result.patch.tablesUpdated[0].recordsUpdated).toEqual([
      {
        recordId: changed,
        cellChanges: [
          { fieldId: title, before: 'Public 0', after: 'Public 1' },
          { fieldId: link, before: null, after: [{ id: visible }] },
        ],
      },
    ]);
    expect(result.summary.cellChanges).toBe(2);
    expect(JSON.stringify(result)).not.toMatch(/withheld|10000|10001|projectionCandidates/);
  } finally {
    await container.dispose();
  }
}, 120_000);
