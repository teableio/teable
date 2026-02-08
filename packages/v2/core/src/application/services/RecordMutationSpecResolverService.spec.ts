import { ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { BaseId } from '../../domain/base/BaseId';
import { ActorId } from '../../domain/shared/ActorId';
import { AndSpec } from '../../domain/shared/specification/AndSpec';
import { FieldId } from '../../domain/table/fields/FieldId';
import { FieldName } from '../../domain/table/fields/FieldName';
import {
  SetAttachmentValueSpec,
  type AttachmentItem,
} from '../../domain/table/records/specs/values/SetAttachmentValueSpec';
import { SetSingleLineTextValueSpec } from '../../domain/table/records/specs/values/SetSingleLineTextValueSpec';
import { SetUserValueByIdentifierSpec } from '../../domain/table/records/specs/values/SetUserValueByIdentifierSpec';
import { SetUserValueSpec } from '../../domain/table/records/specs/values/SetUserValueSpec';
import { CellValue } from '../../domain/table/records/values/CellValue';
import { Table } from '../../domain/table/Table';
import { TableId } from '../../domain/table/TableId';
import { TableName } from '../../domain/table/TableName';
import type {
  AttachmentLookupRecord,
  IAttachmentLookupService,
} from '../../ports/AttachmentLookupService';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import type { ITableRecordQueryRepository } from '../../ports/TableRecordQueryRepository';
import type { TableRecordReadModel } from '../../ports/TableRecordReadModel';
import type { ITableRepository } from '../../ports/TableRepository';
import type { UserLookupRecord, IUserLookupService } from '../../ports/UserLookupService';
import { AttachmentValueResolverService } from './AttachmentValueResolverService';
import { LinkTitleResolverService } from './LinkTitleResolverService';
import { RecordMutationSpecResolverService } from './RecordMutationSpecResolverService';
import { UserValueResolverService } from './UserValueResolverService';

const createContext = (): IExecutionContext => ({
  actorId: ActorId.create('system')._unsafeUnwrap(),
});

class FakeAttachmentLookupService implements IAttachmentLookupService {
  constructor(private readonly records: ReadonlyArray<AttachmentLookupRecord>) {}

  async listAttachmentsByTokens(tokens: ReadonlyArray<string>) {
    return ok(this.records.filter((record) => tokens.includes(record.token)));
  }

  async listAttachmentsByAttachmentIds(attachmentIds: ReadonlyArray<string>) {
    return ok(
      this.records.filter((record) => {
        const key = record.attachmentId ?? record.id;
        return key ? attachmentIds.includes(key) : false;
      })
    );
  }
}

class FakeUserLookupService implements IUserLookupService {
  constructor(private readonly users: ReadonlyArray<UserLookupRecord>) {}

  async listUsersByIdentifiers(identifiers: ReadonlyArray<string>) {
    return ok(
      this.users.filter((user) =>
        identifiers.some(
          (identifier) =>
            identifier === user.id || identifier === user.name || identifier === user.email
        )
      )
    );
  }
}

class FakeTableRepository implements ITableRepository {
  constructor(private readonly table: Table) {}

  async insert() {
    return ok(this.table);
  }

  async insertMany() {
    return ok([this.table]);
  }

  async findOne() {
    return ok(this.table);
  }

  async find() {
    return ok([this.table]);
  }

  async updateOne() {
    return ok(undefined);
  }

  async delete() {
    return ok(undefined);
  }
}

class FakeRecordQueryRepository implements ITableRecordQueryRepository {
  async find(_context: IExecutionContext, _table: Table, _spec?: unknown, _options?: unknown) {
    return ok({ records: [] as TableRecordReadModel[], total: 0 });
  }

  async findOne(
    _context: IExecutionContext,
    _table: Table,
    _recordId: unknown,
    _options?: unknown
  ) {
    return ok({ id: 'rec', fields: {}, version: 1 });
  }

  async *findStream(
    _context: IExecutionContext,
    _table: Table,
    _spec?: unknown,
    _options?: unknown
  ) {
    yield ok({ id: 'rec', fields: {}, version: 1 });
  }
}

const buildTable = () => {
  const baseId = BaseId.create(`bse${'b'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'c'.repeat(16)}`)._unsafeUnwrap();
  const tableName = TableName.create('Test Table')._unsafeUnwrap();
  const fieldName = FieldName.create('Title')._unsafeUnwrap();

  const builder = Table.builder().withId(tableId).withBaseId(baseId).withName(tableName);
  builder.field().singleLineText().withName(fieldName).primary().done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

describe('RecordMutationSpecResolverService', () => {
  it('returns false for non-resolvable specs', () => {
    const fieldId = FieldId.create(`fld${'a'.repeat(16)}`)._unsafeUnwrap();
    const spec = new SetSingleLineTextValueSpec(fieldId, CellValue.fromValidated('hello'));

    const service = new RecordMutationSpecResolverService(
      new LinkTitleResolverService(
        new FakeTableRepository(buildTable()),
        new FakeRecordQueryRepository()
      ),
      new AttachmentValueResolverService(new FakeAttachmentLookupService([])),
      new UserValueResolverService(new FakeUserLookupService([]))
    );

    const result = service.needsResolution(spec);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe(false);
  });

  it('detects resolvable specs', () => {
    const fieldId = FieldId.create(`fld${'b'.repeat(16)}`)._unsafeUnwrap();
    const spec = new SetAttachmentValueSpec(fieldId, CellValue.fromValidated<AttachmentItem[]>([]));

    const service = new RecordMutationSpecResolverService(
      new LinkTitleResolverService(
        new FakeTableRepository(buildTable()),
        new FakeRecordQueryRepository()
      ),
      new AttachmentValueResolverService(new FakeAttachmentLookupService([])),
      new UserValueResolverService(new FakeUserLookupService([]))
    );

    const result = service.needsResolution(spec);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe(true);
  });

  it('returns original spec when no resolution needed', async () => {
    const fieldId = FieldId.create(`fld${'c'.repeat(16)}`)._unsafeUnwrap();
    const spec = new SetSingleLineTextValueSpec(fieldId, CellValue.fromValidated('alpha'));

    const service = new RecordMutationSpecResolverService(
      new LinkTitleResolverService(
        new FakeTableRepository(buildTable()),
        new FakeRecordQueryRepository()
      ),
      new AttachmentValueResolverService(new FakeAttachmentLookupService([])),
      new UserValueResolverService(new FakeUserLookupService([]))
    );

    const result = await service.resolveAndReplace(createContext(), spec);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe(spec);
  });

  it('replaces resolvable specs with resolved values', async () => {
    const attachmentFieldId = FieldId.create(`fld${'d'.repeat(16)}`)._unsafeUnwrap();
    const userFieldId = FieldId.create(`fld${'e'.repeat(16)}`)._unsafeUnwrap();

    const attachmentItem: AttachmentItem = {
      id: 'att-1',
      name: 'Input',
      path: '',
      token: 'tok-1',
      size: 0,
      mimetype: 'text/plain',
    };
    const attachmentSpec = new SetAttachmentValueSpec(
      attachmentFieldId,
      CellValue.fromValidated<AttachmentItem[]>([attachmentItem])
    );
    const userSpec = SetUserValueByIdentifierSpec.create(userFieldId, ['usr-1'], false);
    const spec = new AndSpec(attachmentSpec, userSpec);

    const attachmentLookup = new FakeAttachmentLookupService([
      {
        id: 'act-1',
        attachmentId: 'att-1',
        token: 'tok-1',
        name: 'Stored',
        path: '/stored/path',
        size: 10,
        mimetype: 'text/plain',
      },
    ]);
    const userLookup = new FakeUserLookupService([
      { id: 'usr-1', name: 'Alice', email: 'alice@example.com' },
    ]);

    const service = new RecordMutationSpecResolverService(
      new LinkTitleResolverService(
        new FakeTableRepository(buildTable()),
        new FakeRecordQueryRepository()
      ),
      new AttachmentValueResolverService(attachmentLookup),
      new UserValueResolverService(userLookup)
    );

    const result = await service.resolveAndReplace(createContext(), spec);
    const replaced = result._unsafeUnwrap();

    expect(replaced).toBeInstanceOf(AndSpec);
    const left = (replaced as AndSpec<unknown>).leftSpec();
    const right = (replaced as AndSpec<unknown>).rightSpec();

    expect(left).toBeInstanceOf(SetAttachmentValueSpec);
    expect(right).toBeInstanceOf(SetUserValueSpec);
    const userValue = (right as SetUserValueSpec).value.toValue();
    expect(userValue).toEqual({
      id: 'usr-1',
      title: 'Alice',
      email: 'alice@example.com',
      avatarUrl: '/api/attachments/read/public/avatar/usr-1',
    });
  });

  it('resolveAndReplaceMany batches resolution for multiple specs', async () => {
    const userFieldId = FieldId.create(`fld${'f'.repeat(16)}`)._unsafeUnwrap();
    const userFieldId3 = FieldId.create(`fld${'h'.repeat(16)}`)._unsafeUnwrap();

    // Create multiple specs that need user resolution (same field across records)
    const spec1 = SetUserValueByIdentifierSpec.create(userFieldId, ['usr-1'], false);
    const spec2 = SetUserValueByIdentifierSpec.create(userFieldId, ['usr-2'], false);
    const spec3 = SetUserValueByIdentifierSpec.create(userFieldId3, ['usr-3'], false);

    // Track how many times the lookup service is called
    let lookupCallCount = 0;
    let lookupIdentifiers: string[] = [];
    const userLookup: IUserLookupService = {
      async listUsersByIdentifiers(identifiers: ReadonlyArray<string>) {
        lookupCallCount++;
        lookupIdentifiers = [...identifiers];
        const users = [
          { id: 'usr-1', name: 'Alice', email: 'alice@example.com' },
          { id: 'usr-2', name: 'Bob', email: 'bob@example.com' },
          { id: 'usr-3', name: 'Charlie', email: 'charlie@example.com' },
        ];
        return ok(users.filter((u) => identifiers.includes(u.id)));
      },
    };

    const service = new RecordMutationSpecResolverService(
      new LinkTitleResolverService(
        new FakeTableRepository(buildTable()),
        new FakeRecordQueryRepository()
      ),
      new AttachmentValueResolverService(new FakeAttachmentLookupService([])),
      new UserValueResolverService(userLookup)
    );

    // Call resolveAndReplaceMany with multiple specs
    const result = await service.resolveAndReplaceMany(createContext(), [
      spec1,
      spec2,
      null,
      spec3,
    ]);

    expect(result.isOk()).toBe(true);
    const resolved = result._unsafeUnwrap();

    // Should return same length array
    expect(resolved).toHaveLength(4);

    // Null should stay null
    expect(resolved[2]).toBeNull();

    // All specs should be resolved
    expect(resolved[0]).toBeInstanceOf(SetUserValueSpec);
    expect(resolved[1]).toBeInstanceOf(SetUserValueSpec);
    expect(resolved[3]).toBeInstanceOf(SetUserValueSpec);

    // Verify the resolved values
    expect((resolved[0] as SetUserValueSpec).value.toValue()).toMatchObject({
      id: 'usr-1',
      title: 'Alice',
    });
    expect((resolved[1] as SetUserValueSpec).value.toValue()).toMatchObject({
      id: 'usr-2',
      title: 'Bob',
    });
    expect((resolved[3] as SetUserValueSpec).value.toValue()).toMatchObject({
      id: 'usr-3',
      title: 'Charlie',
    });

    // CRITICAL: Should only call lookup ONCE (batched), not 3 times
    expect(lookupCallCount).toBe(1);
    // All identifiers should be looked up in a single batch
    expect(lookupIdentifiers).toContain('usr-1');
    expect(lookupIdentifiers).toContain('usr-2');
    expect(lookupIdentifiers).toContain('usr-3');
  });
});
