import { AsyncLocalStorage } from 'node:async_hooks';
import { v2DataDbTokens, v2MetaDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import {
  ActorId,
  DefaultTableMapper,
  NoopLogger,
  RecordQueryPluginRunner,
  v2CoreTokens,
  type IRecordQueryPlugin,
} from '@teable/v2-core';
import { ClsService } from 'nestjs-cls';
import { ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IClsStore } from '../../types/cls';
import { V2DataQueryService } from './v2-data-query.service';

const mocks = vi.hoisted(() => ({ admit: vi.fn(), execute: vi.fn() }));
vi.mock('./v2-data-query-admission', () => ({ admitDataQueryResource: mocks.admit }));
vi.mock('./v2-container.service', () => ({ V2ContainerService: class V2ContainerService {} }));
vi.mock('./v2-execution-context.factory', () => ({
  V2ExecutionContextFactory: class V2ExecutionContextFactory {},
}));
vi.mock('./v2-data-query-candidate.service', () => ({
  V2DataQueryCandidateService: class V2DataQueryCandidateService {},
}));
vi.mock('@teable/v2-adapter-table-repository-postgres', () => ({
  PostgresDataQueryExecutor: class PostgresDataQueryExecutor {
    execute = mocks.execute;
  },
}));

const tableId = `tbl${'a'.repeat(16)}`;
const titleId = `fld${'a'.repeat(16)}`;
const amountId = `fld${'b'.repeat(16)}`;
const baseId = `bse${'a'.repeat(16)}`;
const definition = {
  version: 1,
  kind: 'records',
  tableId,
  select: [{ fieldId: titleId, alias: 'title' }],
};
const candidate = { operation: 'delete' as const, tableId, fieldIds: [amountId] };
const admission = { spaceId: 'spc_synthetic', permissions: ['record|read'], route: 'synthetic' };

const setup = (validation: boolean) => {
  const cls = new ClsService<IClsStore>(new AsyncLocalStorage());
  const table = new DefaultTableMapper()
    .toDomain({
      id: tableId,
      baseId,
      name: 'Synthetic validation',
      dbTableName: 'synthetic.validation',
      primaryFieldId: titleId,
      fields: [
        { id: titleId, name: 'Title', type: 'singleLineText', dbFieldName: 'title' },
        { id: amountId, name: 'Amount', type: 'number', dbFieldName: 'amount' },
      ],
      views: [{ id: `viw${'a'.repeat(16)}`, name: 'Grid', type: 'grid', columnMeta: {} }],
    })
    ._unsafeUnwrap();
  const findOne = vi.fn(async () => {
    expect(cls.get('v2PreviewReadOnly')).toBe(validation ? true : undefined);
    return ok(table);
  });
  const scope = vi.fn(() => {
    expect(cls.get('v2PreviewReadOnly')).toBe(validation ? true : undefined);
    return ok({});
  });
  const plugin: IRecordQueryPlugin = { name: 'readonly-scope-probe', supports: () => true, scope };
  const runner = new RecordQueryPluginRunner([plugin], new NoopLogger());
  const metadata = {};
  const container = {
    resolve: vi.fn((token: symbol) => {
      if (token === v2MetaDbTokens.db) return metadata;
      if (token === v2CoreTokens.tableRepository) return { findOne };
      if (token === v2CoreTokens.recordQueryPluginRunner) return runner;
      throw new Error(`Unexpected metadata token: ${String(token)}`);
    }),
  };
  const getContainer = vi.fn(async () => {
    if (validation) throw new Error('Normal metadata acquisition is forbidden during validation');
    return container;
  });
  const getPreviewContainer = vi.fn(async () => {
    expect(cls.get('v2PreviewReadOnly')).toBe(true);
    return container;
  });
  const dataContainer = {
    resolve: vi.fn((token: symbol) => {
      if (token !== v2DataDbTokens.db) throw new Error('Expected data database');
      return {};
    }),
  };
  const getContainerForRoutingSnapshot = vi.fn(async () => {
    if (validation) throw new Error('Record execution is forbidden during validation');
    return dataContainer;
  });
  const createContext = vi.fn(async (selectedContainer: unknown) => {
    expect(selectedContainer).toBe(container);
    return { actorId: ActorId.create(cls.get('user.id'))._unsafeUnwrap() };
  });
  const prepareAuthorizedCandidate = vi.fn(async () => {
    expect(cls.get('v2PreviewReadOnly')).toBe(true);
    expect(cls.get('user.id')).toBe('app-reader');
    return ok(new Map([[tableId, table]]));
  });
  const service = new V2DataQueryService(
    { getContainer, getPreviewContainer, getContainerForRoutingSnapshot } as never,
    { createContext } as never,
    cls,
    { prepareAuthorizedCandidate } as never
  );
  return {
    cls,
    service,
    getContainer,
    getPreviewContainer,
    getContainerForRoutingSnapshot,
    prepareAuthorizedCandidate,
    findOne,
    scope,
  };
};

const actor = {
  user: { id: 'app-reader', name: 'Reader', email: 'reader@example.test' },
  permissions: [],
  appId: 'synthetic-app',
} as unknown as IClsStore;

describe('V2DataQueryService readonly validation acquisition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.admit.mockResolvedValue(admission);
    mocks.execute.mockResolvedValue(ok({ rows: [] }));
  });

  it.each([false, true])(
    'validates current/candidate schema without normal acquisition: %s',
    async (withCandidate) => {
      const fixture = setup(true);
      await fixture.cls.runWith(actor, async () => {
        const response = await fixture.service.validate(
          {
            definition,
            includeUsage: true,
            ...(withCandidate ? { candidate, candidateProof: 'synthetic-proof' } : {}),
          },
          'Bearer synthetic-token'
        );
        expect(response.status).toBe(200);
        expect(response.body.ok).toBe(true);
        expect(fixture.cls.get('v2PreviewReadOnly')).toBeUndefined();
        expect(fixture.cls.get('user.id')).toBe('app-reader');
      });

      expect(fixture.getPreviewContainer).toHaveBeenCalledOnce();
      expect(fixture.getContainer).not.toHaveBeenCalled();
      expect(fixture.getContainerForRoutingSnapshot).not.toHaveBeenCalled();
      expect(fixture.findOne).toHaveBeenCalled();
      expect(fixture.scope).toHaveBeenCalled();
      expect(mocks.execute).not.toHaveBeenCalled();
      if (withCandidate) {
        expect(fixture.prepareAuthorizedCandidate).toHaveBeenCalledWith(
          expect.objectContaining({ actorId: expect.anything() }),
          candidate,
          'synthetic-proof',
          'synthetic-token'
        );
      } else {
        expect(fixture.prepareAuthorizedCandidate).not.toHaveBeenCalled();
      }
    }
  );

  it('retains normal metadata and admitted routing acquisition for execution', async () => {
    const fixture = setup(false);
    const response = await fixture.cls.runWith(actor, () =>
      fixture.service.execute({ definition })
    );

    expect(response.status).toBe(200);
    expect(fixture.getContainer).toHaveBeenCalledOnce();
    expect(fixture.getPreviewContainer).not.toHaveBeenCalled();
    expect(fixture.getContainerForRoutingSnapshot).toHaveBeenCalledWith(admission);
    expect(mocks.execute).toHaveBeenCalledOnce();
  });
});
