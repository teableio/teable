import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../domain/shared/DomainError';
import type { ICellValueSpec } from '../../domain/table/records/specs/values/ICellValueSpecVisitor';
import { SetUserValueByIdentifierSpec } from '../../domain/table/records/specs/values/SetUserValueByIdentifierSpec';
import {
  SetUserValueSpec,
  type UserItem,
} from '../../domain/table/records/specs/values/SetUserValueSpec';
import { CellValue } from '../../domain/table/records/values/CellValue';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import { v2CoreTokens } from '../../ports/tokens';
import { IUserLookupService } from '../../ports/UserLookupService';
import type { UserLookupRecord } from '../../ports/UserLookupService';
import type { ICellValueSpecResolver } from './SpecResolver';

const buildAvatarUrl = (userId: string): string => {
  return `/api/attachments/read/public/avatar/${userId}`;
};

const normalizeUserValue = (value: unknown): { items: UserItem[]; isArray: boolean } => {
  if (Array.isArray(value)) {
    return { items: value as UserItem[], isArray: true };
  }
  if (value && typeof value === 'object') {
    return { items: [value as UserItem], isArray: false };
  }
  return { items: [], isArray: true };
};

const toUserItem = (user: UserLookupRecord): UserItem => {
  return {
    id: user.id,
    title: user.name,
    email: user.email ?? undefined,
    avatarUrl: buildAvatarUrl(user.id),
  };
};

@injectable()
export class UserValueResolverService
  implements ICellValueSpecResolver<SetUserValueSpec | SetUserValueByIdentifierSpec>
{
  constructor(
    @inject(v2CoreTokens.userLookupService)
    private readonly userLookupService: IUserLookupService
  ) {}

  supports(spec: ICellValueSpec): spec is SetUserValueSpec | SetUserValueByIdentifierSpec {
    return spec instanceof SetUserValueSpec || spec instanceof SetUserValueByIdentifierSpec;
  }

  async resolveSpecs(
    context: IExecutionContext,
    specs: ReadonlyArray<SetUserValueSpec | SetUserValueByIdentifierSpec>
  ): Promise<Result<ReadonlyArray<ICellValueSpec>, DomainError>> {
    const service = this;
    return safeTry<ReadonlyArray<ICellValueSpec>, DomainError>(async function* () {
      const resolveIdentifier = (identifier: string): Result<string, DomainError> => {
        if (identifier !== 'me') return ok(identifier);
        if (!context.actorId) {
          return err(
            domainError.unauthorized({
              code: 'unauthorized.missing_actor',
              message: 'Current user is required to resolve "me"',
            })
          );
        }
        return ok(context.actorId.toString());
      };

      const strictIds = new Set<string>();
      const identifiers = new Set<string>();

      for (const spec of specs) {
        if (spec instanceof SetUserValueByIdentifierSpec) {
          for (const identifier of spec.identifiers) {
            const idResult = resolveIdentifier(String(identifier));
            if (idResult.isErr()) {
              return err(idResult.error);
            }
            identifiers.add(idResult.value);
          }
          continue;
        }

        const rawValue = spec.value.toValue();
        if (rawValue == null) continue;
        const normalized = normalizeUserValue(rawValue);
        for (const item of normalized.items) {
          if (!item || typeof item !== 'object' || !('id' in item)) {
            return err(
              domainError.validation({
                code: 'validation.field.invalid_user_format',
                message: 'Invalid user format',
              })
            );
          }
          const idResult = resolveIdentifier(String(item.id));
          if (idResult.isErr()) {
            return err(idResult.error);
          }
          strictIds.add(idResult.value);
        }
      }

      const lookupKeys = [...new Set([...strictIds, ...identifiers])];
      const usersResult = yield* await service.userLookupService.listUsersByIdentifiers(lookupKeys);

      const usersById = new Map<string, UserLookupRecord>();
      const usersByEmail = new Map<string, UserLookupRecord>();
      const usersByName = new Map<string, UserLookupRecord>();

      for (const user of usersResult) {
        usersById.set(user.id, user);
        if (user.email) {
          usersByEmail.set(user.email, user);
        }
        usersByName.set(user.name, user);
      }

      const resolvedSpecs: ICellValueSpec[] = [];

      for (const spec of specs) {
        if (spec instanceof SetUserValueByIdentifierSpec) {
          if (spec.identifiers.length === 0) {
            resolvedSpecs.push(
              new SetUserValueSpec(
                spec.fieldId,
                CellValue.fromValidated<UserItem[]>(spec.isMultiple ? [] : null)
              )
            );
            continue;
          }

          const resolvedItems: UserItem[] = [];
          for (const identifier of spec.identifiers) {
            const keyResult = resolveIdentifier(String(identifier));
            if (keyResult.isErr()) {
              return err(keyResult.error);
            }
            const key = keyResult.value;
            const user = usersById.get(key) ?? usersByEmail.get(key) ?? usersByName.get(key);
            if (!user) {
              return err(
                domainError.validation({
                  code: 'validation.field.user_not_found',
                  message: `User(${key}) not found in table`,
                })
              );
            }
            resolvedItems.push(toUserItem(user));
          }

          const resolvedValue = spec.isMultiple ? resolvedItems : resolvedItems[0] ?? null;
          resolvedSpecs.push(
            new SetUserValueSpec(
              spec.fieldId,
              CellValue.fromValidated<UserItem[]>(resolvedValue as UserItem[] | null)
            )
          );
          continue;
        }

        const rawValue = spec.value.toValue();
        if (rawValue == null) {
          resolvedSpecs.push(new SetUserValueSpec(spec.fieldId, CellValue.null<UserItem[]>()));
          continue;
        }

        const normalized = normalizeUserValue(rawValue);
        const resolvedItems: UserItem[] = [];

        for (const item of normalized.items) {
          const idResult = resolveIdentifier(String(item.id));
          if (idResult.isErr()) {
            return err(idResult.error);
          }
          const id = idResult.value;
          const user = usersById.get(id);
          if (!user) {
            return err(
              domainError.validation({
                code: 'validation.field.user_not_found',
                message: `User(${id}) not found in table`,
              })
            );
          }
          resolvedItems.push(toUserItem(user));
        }

        const resolvedValue = normalized.isArray ? resolvedItems : resolvedItems[0] ?? null;
        resolvedSpecs.push(
          new SetUserValueSpec(
            spec.fieldId,
            CellValue.fromValidated<UserItem[]>(resolvedValue as UserItem[] | null)
          )
        );
      }

      return ok(resolvedSpecs);
    });
  }
}
