import { ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { ActorId } from '../../domain/shared/ActorId';
import { FieldId } from '../../domain/table/fields/FieldId';
import { SetUserValueByIdentifierSpec } from '../../domain/table/records/specs/values/SetUserValueByIdentifierSpec';
import {
  SetUserValueSpec,
  type UserItem,
} from '../../domain/table/records/specs/values/SetUserValueSpec';
import { CellValue } from '../../domain/table/records/values/CellValue';
import { TableId } from '../../domain/table/TableId';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import type { IUserLookupService, UserLookupRecord } from '../../ports/UserLookupService';
import { UserValueResolverService } from './UserValueResolverService';

const testTableId = TableId.create(`tbl${'t'.repeat(16)}`)._unsafeUnwrap();

const createContext = (): IExecutionContext => ({
  actorId: ActorId.create('system')._unsafeUnwrap(),
});

class FakeUserLookupService implements IUserLookupService {
  constructor(
    private readonly collaborators: ReadonlyArray<UserLookupRecord>,
    private readonly platformUsers: ReadonlyArray<UserLookupRecord> = collaborators
  ) {}

  async listTableUsersByIdentifiers(_tableId: string, identifiers: ReadonlyArray<string>) {
    return ok(
      this.collaborators.filter((user) =>
        identifiers.some(
          (identifier) =>
            identifier === user.id || identifier === user.name || identifier === user.email
        )
      )
    );
  }

  async listUsersByIdentityPairs(pairs: ReadonlyArray<{ id: string; email: string }>) {
    return ok(
      this.platformUsers.filter((user) =>
        pairs.some((pair) => pair.id === user.id && pair.email === user.email)
      )
    );
  }

  async listUsersByIds(ids: ReadonlyArray<string>) {
    return ok(this.platformUsers.filter((user) => ids.includes(user.id)));
  }
}

describe('UserValueResolverService', () => {
  it('returns unauthorized error when resolving "me" without actor', async () => {
    const fieldId = FieldId.create(`fld${'a'.repeat(16)}`)._unsafeUnwrap();
    const spec = SetUserValueByIdentifierSpec.create(fieldId, ['me'], false);

    const context = { actorId: undefined } as unknown as IExecutionContext;
    const service = new UserValueResolverService(new FakeUserLookupService([]));
    const result = await service.resolveSpecs(context, testTableId, [spec]);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('unauthorized.missing_actor');
  });

  it('resolves strict user specs by id', async () => {
    const fieldId = FieldId.create(`fld${'b'.repeat(16)}`)._unsafeUnwrap();
    const inputUser: UserItem = { id: 'usr-1', title: 'Input' };
    const spec = new SetUserValueSpec(fieldId, CellValue.fromValidated<UserItem[]>([inputUser]));

    const service = new UserValueResolverService(
      new FakeUserLookupService([{ id: 'usr-1', name: 'Alice', email: 'alice@example.com' }])
    );
    const result = await service.resolveSpecs(createContext(), testTableId, [spec]);
    const resolvedSpec = result._unsafeUnwrap()[0];

    expect(resolvedSpec).toBeInstanceOf(SetUserValueSpec);
    const resolvedValue = (resolvedSpec as SetUserValueSpec).value.toValue();
    expect(resolvedValue).toEqual([
      {
        id: 'usr-1',
        title: 'Alice',
        email: 'alice@example.com',
        avatarUrl: '/api/attachments/read/public/avatar/usr-1',
      },
    ]);
  });

  it('resolves missing lookup avatar from public storage config', async () => {
    const previousPublicUrl = process.env.BACKEND_STORAGE_PUBLIC_URL;
    process.env.BACKEND_STORAGE_PUBLIC_URL = 'https://storage-public.teable.io';

    try {
      const fieldId = FieldId.create(`fld${'e'.repeat(16)}`)._unsafeUnwrap();
      const inputUser: UserItem = { id: 'usr-1', title: 'Input' };
      const spec = new SetUserValueSpec(fieldId, CellValue.fromValidated<UserItem[]>([inputUser]));

      const service = new UserValueResolverService(
        new FakeUserLookupService([{ id: 'usr-1', name: 'Alice', email: 'alice@example.com' }])
      );
      const result = await service.resolveSpecs(createContext(), testTableId, [spec]);
      const resolvedSpec = result._unsafeUnwrap()[0];

      expect(resolvedSpec).toBeInstanceOf(SetUserValueSpec);
      const resolvedValue = (resolvedSpec as SetUserValueSpec).value.toValue();
      expect(resolvedValue).toEqual([
        {
          id: 'usr-1',
          title: 'Alice',
          email: 'alice@example.com',
          avatarUrl: 'https://storage-public.teable.io/avatar/usr-1',
        },
      ]);
    } finally {
      if (previousPublicUrl === undefined) {
        delete process.env.BACKEND_STORAGE_PUBLIC_URL;
      } else {
        process.env.BACKEND_STORAGE_PUBLIC_URL = previousPublicUrl;
      }
    }
  });

  it('resolves empty identifiers to empty list for multiple', async () => {
    const fieldId = FieldId.create(`fld${'c'.repeat(16)}`)._unsafeUnwrap();
    const spec = SetUserValueByIdentifierSpec.create(fieldId, [], true);

    const service = new UserValueResolverService(new FakeUserLookupService([]));
    const result = await service.resolveSpecs(createContext(), testTableId, [spec]);
    const resolvedSpec = result._unsafeUnwrap()[0];

    expect(resolvedSpec).toBeInstanceOf(SetUserValueSpec);
    const resolvedValue = (resolvedSpec as SetUserValueSpec).value.toValue();
    expect(resolvedValue).toEqual([]);
  });

  it('clears the cell when a text identifier matches no collaborator', async () => {
    const fieldId = FieldId.create(`fld${'d'.repeat(16)}`)._unsafeUnwrap();
    const spec = SetUserValueByIdentifierSpec.create(fieldId, ['missing@example.com'], false);

    const service = new UserValueResolverService(
      new FakeUserLookupService([{ id: 'usr-2', name: 'Bob', email: 'bob@example.com' }])
    );
    const result = await service.resolveSpecs(createContext(), testTableId, [spec]);
    const resolvedSpec = result._unsafeUnwrap()[0];

    expect(resolvedSpec).toBeInstanceOf(SetUserValueSpec);
    expect((resolvedSpec as SetUserValueSpec).value.toValue()).toBeNull();
  });

  it('drops only the unmatched identifiers for multiple user cells', async () => {
    const fieldId = FieldId.create(`fld${'f'.repeat(16)}`)._unsafeUnwrap();
    const spec = SetUserValueByIdentifierSpec.create(fieldId, ['Bob', 'missing@example.com'], true);

    const service = new UserValueResolverService(
      new FakeUserLookupService([{ id: 'usr-2', name: 'Bob', email: 'bob@example.com' }])
    );
    const result = await service.resolveSpecs(createContext(), testTableId, [spec]);
    const resolvedSpec = result._unsafeUnwrap()[0];

    expect(resolvedSpec).toBeInstanceOf(SetUserValueSpec);
    expect((resolvedSpec as SetUserValueSpec).value.toValue()).toEqual([
      {
        id: 'usr-2',
        title: 'Bob',
        email: 'bob@example.com',
        avatarUrl: '/api/attachments/read/public/avatar/usr-2',
      },
    ]);
  });

  it('preserves server-created trusted user specs without collaborator scoping', async () => {
    const fieldId = FieldId.create(`fld${'g'.repeat(16)}`)._unsafeUnwrap();
    const inputUser: UserItem = { id: 'usr-outsider', title: 'Copied' };
    // Internal specs preserve trusted existing identities; public visitors set requireCollaborator.
    const spec = new SetUserValueSpec(fieldId, CellValue.fromValidated<UserItem[]>([inputUser]));

    const outsider = { id: 'usr-outsider', name: 'Outsider', email: 'outsider@example.com' };
    const service = new UserValueResolverService(
      // The outsider exists on the platform but is not a base/space collaborator.
      new FakeUserLookupService([], [outsider])
    );
    const result = await service.resolveSpecs(createContext(), testTableId, [spec]);
    const resolvedSpec = result._unsafeUnwrap()[0];

    expect(resolvedSpec).toBeInstanceOf(SetUserValueSpec);
    expect((resolvedSpec as SetUserValueSpec).value.toValue()).toEqual([
      {
        id: 'usr-outsider',
        title: 'Outsider',
        email: 'outsider@example.com',
        avatarUrl: '/api/attachments/read/public/avatar/usr-outsider',
      },
    ]);
  });

  it('returns validation error when a structured user id does not exist on the platform', async () => {
    const fieldId = FieldId.create(`fld${'h'.repeat(16)}`)._unsafeUnwrap();
    const inputUser: UserItem = { id: 'usr-ghost', title: 'Ghost' };
    const spec = new SetUserValueSpec(fieldId, CellValue.fromValidated<UserItem[]>([inputUser]));

    const service = new UserValueResolverService(new FakeUserLookupService([]));
    const result = await service.resolveSpecs(createContext(), testTableId, [spec]);

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe('validation.field.user_not_found');
    expect(error.localization).toEqual({ i18nKey: 'httpErrors.user.notFound' });
  });

  it('verifies each supplied pair without letting one item authorize another', async () => {
    const fieldId = FieldId.create(`fld${'p'.repeat(16)}`)._unsafeUnwrap();
    const outsider = { id: 'usr-outsider', name: 'Outsider', email: 'outside@example.com' };
    const service = new UserValueResolverService(new FakeUserLookupService([], [outsider]));
    const valid = { id: outsider.id, email: outsider.email, title: 'forged' };
    const accepted = await service.resolveSpecs(createContext(), testTableId, [
      new SetUserValueSpec(fieldId, CellValue.fromValidated<UserItem[]>([valid]), true),
    ]);
    expect((accepted._unsafeUnwrap()[0] as SetUserValueSpec).value.toValue()).toMatchObject([
      { id: outsider.id, email: outsider.email, title: outsider.name },
    ]);

    for (const invalid of [
      { id: outsider.id, title: 'No email' },
      { id: outsider.id, email: 'wrong@example.com', title: 'Wrong email' },
      { id: outsider.id, email: '', title: 'Empty email' },
      {
        id: { toString: () => outsider.id },
        email: outsider.email,
        title: 'Coerced',
      } as unknown as UserItem,
    ]) {
      const result = await service.resolveSpecs(createContext(), testTableId, [
        new SetUserValueSpec(fieldId, CellValue.fromValidated<UserItem[]>([valid, invalid]), true),
      ]);
      expect(result._unsafeUnwrapErr().code).toBe('validation.field.user_not_found');
    }
  });

  it('rejects a collaborator-scoped structured user id that is not a collaborator', async () => {
    const fieldId = FieldId.create(`fld${'i'.repeat(16)}`)._unsafeUnwrap();
    const spec = new SetUserValueSpec(
      fieldId,
      CellValue.fromValidated<UserItem[]>([{ id: 'usr-outsider' } as UserItem]),
      true
    );

    const outsider = { id: 'usr-outsider', name: 'Outsider', email: 'outsider@example.com' };
    const service = new UserValueResolverService(
      // The outsider exists on the platform but is not a base/space collaborator.
      new FakeUserLookupService([], [outsider])
    );
    const result = await service.resolveSpecs(createContext(), testTableId, [spec]);

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe('validation.field.user_not_found');
    expect(error.localization).toEqual({ i18nKey: 'httpErrors.user.notFound' });
  });

  it('resolves a collaborator-scoped structured user id for a table collaborator', async () => {
    const fieldId = FieldId.create(`fld${'j'.repeat(16)}`)._unsafeUnwrap();
    const spec = new SetUserValueSpec(
      fieldId,
      CellValue.fromValidated<UserItem[]>([{ id: 'usr-1' } as UserItem]),
      true
    );

    const collaborator = { id: 'usr-1', name: 'Alice', email: 'alice@example.com' };
    const service = new UserValueResolverService(new FakeUserLookupService([collaborator]));
    const result = await service.resolveSpecs(createContext(), testTableId, [spec]);
    const resolvedSpec = result._unsafeUnwrap()[0];

    expect((resolvedSpec as SetUserValueSpec).value.toValue()).toEqual([
      {
        id: 'usr-1',
        title: 'Alice',
        email: 'alice@example.com',
        avatarUrl: '/api/attachments/read/public/avatar/usr-1',
      },
    ]);
  });

  it('considers only the first identifier for a single user field', async () => {
    const fieldId = FieldId.create(`fld${'k'.repeat(16)}`)._unsafeUnwrap();
    const spec = SetUserValueByIdentifierSpec.create(fieldId, ['不存在的人', '李四'], false);

    const service = new UserValueResolverService(
      new FakeUserLookupService([{ id: 'usr-2', name: '李四', email: 'lisi@example.com' }])
    );
    const result = await service.resolveSpecs(createContext(), testTableId, [spec]);
    const resolvedSpec = result._unsafeUnwrap()[0];

    expect(resolvedSpec).toBeInstanceOf(SetUserValueSpec);
    // v1 parity: the unmatched first token clears the cell instead of falling
    // back to the later identifier.
    expect((resolvedSpec as SetUserValueSpec).value.toValue()).toBeNull();
  });

  it('resolves the first identifier for a single user field when it matches', async () => {
    const fieldId = FieldId.create(`fld${'l'.repeat(16)}`)._unsafeUnwrap();
    const spec = SetUserValueByIdentifierSpec.create(fieldId, ['李四', '不存在的人'], false);

    const service = new UserValueResolverService(
      new FakeUserLookupService([{ id: 'usr-2', name: '李四', email: 'lisi@example.com' }])
    );
    const result = await service.resolveSpecs(createContext(), testTableId, [spec]);
    const resolvedSpec = result._unsafeUnwrap()[0];

    expect((resolvedSpec as SetUserValueSpec).value.toValue()).toEqual({
      id: 'usr-2',
      title: '李四',
      email: 'lisi@example.com',
      avatarUrl: '/api/attachments/read/public/avatar/usr-2',
    });
  });

  it('clears a single user field when the first identifier is empty', async () => {
    const fieldId = FieldId.create(`fld${'m'.repeat(16)}`)._unsafeUnwrap();
    const spec = SetUserValueByIdentifierSpec.create(fieldId, ['', '李四'], false);

    const service = new UserValueResolverService(
      new FakeUserLookupService([{ id: 'usr-2', name: '李四', email: 'lisi@example.com' }])
    );
    const result = await service.resolveSpecs(createContext(), testTableId, [spec]);
    const resolvedSpec = result._unsafeUnwrap()[0];

    // v1 parity: `matchUser('')` finds nobody, so the cell clears.
    expect((resolvedSpec as SetUserValueSpec).value.toValue()).toBeNull();
  });
});
