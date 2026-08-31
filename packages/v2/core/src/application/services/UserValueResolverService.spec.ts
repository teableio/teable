import { ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { ActorId } from '../../domain/shared/ActorId';
import { FieldId } from '../../domain/table/fields/FieldId';
import { TableId } from '../../domain/table/TableId';
import { SetUserValueByIdentifierSpec } from '../../domain/table/records/specs/values/SetUserValueByIdentifierSpec';
import {
  SetUserValueSpec,
  type UserItem,
} from '../../domain/table/records/specs/values/SetUserValueSpec';
import { CellValue } from '../../domain/table/records/values/CellValue';
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

  it('resolves structured user values without collaborator scoping', async () => {
    const fieldId = FieldId.create(`fld${'g'.repeat(16)}`)._unsafeUnwrap();
    const inputUser: UserItem = { id: 'usr-outsider', title: 'Copied' };
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
});
