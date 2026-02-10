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
import type { IExecutionContext } from '../../ports/ExecutionContext';
import type { IUserLookupService, UserLookupRecord } from '../../ports/UserLookupService';
import { UserValueResolverService } from './UserValueResolverService';

const createContext = (): IExecutionContext => ({
  actorId: ActorId.create('system')._unsafeUnwrap(),
});

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

describe('UserValueResolverService', () => {
  it('returns unauthorized error when resolving "me" without actor', async () => {
    const fieldId = FieldId.create(`fld${'a'.repeat(16)}`)._unsafeUnwrap();
    const spec = SetUserValueByIdentifierSpec.create(fieldId, ['me'], false);

    const context = { actorId: undefined } as unknown as IExecutionContext;
    const service = new UserValueResolverService(new FakeUserLookupService([]));
    const result = await service.resolveSpecs(context, [spec]);

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
    const result = await service.resolveSpecs(createContext(), [spec]);
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

  it('resolves empty identifiers to empty list for multiple', async () => {
    const fieldId = FieldId.create(`fld${'c'.repeat(16)}`)._unsafeUnwrap();
    const spec = SetUserValueByIdentifierSpec.create(fieldId, [], true);

    const service = new UserValueResolverService(new FakeUserLookupService([]));
    const result = await service.resolveSpecs(createContext(), [spec]);
    const resolvedSpec = result._unsafeUnwrap()[0];

    expect(resolvedSpec).toBeInstanceOf(SetUserValueSpec);
    const resolvedValue = (resolvedSpec as SetUserValueSpec).value.toValue();
    expect(resolvedValue).toEqual([]);
  });

  it('returns validation error when user not found', async () => {
    const fieldId = FieldId.create(`fld${'d'.repeat(16)}`)._unsafeUnwrap();
    const spec = SetUserValueByIdentifierSpec.create(fieldId, ['missing@example.com'], false);

    const service = new UserValueResolverService(
      new FakeUserLookupService([{ id: 'usr-2', name: 'Bob', email: 'bob@example.com' }])
    );
    const result = await service.resolveSpecs(createContext(), [spec]);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('validation.field.user_not_found');
  });
});
