import { sdkErrorI18nKeys } from '@teable/i18n-keys';
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
import type { TableId } from '../../domain/table/TableId';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import { v2CoreTokens } from '../../ports/tokens';
import { buildUserAvatarUrl } from '../../ports/UserAvatarUrl';
import type { IUserLookupService, UserLookupRecord } from '../../ports/UserLookupService';
import type { ICellValueSpecResolver } from './SpecResolver';

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
    avatarUrl: user.avatarUrl ?? buildUserAvatarUrl(user.id),
  };
};

@injectable()
export class UserValueResolverService implements ICellValueSpecResolver<
  SetUserValueSpec | SetUserValueByIdentifierSpec
> {
  constructor(
    @inject(v2CoreTokens.userLookupService)
    private readonly userLookupService: IUserLookupService
  ) {}

  supports(spec: ICellValueSpec): spec is SetUserValueSpec | SetUserValueByIdentifierSpec {
    return spec instanceof SetUserValueSpec || spec instanceof SetUserValueByIdentifierSpec;
  }

  async resolveSpecs(
    context: IExecutionContext,
    tableId: TableId,
    specs: ReadonlyArray<SetUserValueSpec | SetUserValueByIdentifierSpec>
  ): Promise<Result<ReadonlyArray<ICellValueSpec>, DomainError>> {
    const service = this; // NOSONAR typescript:S7740 -- generator functions cannot be arrow functions, so `this` must be captured
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
      // Incomplete caller-controlled references resolve within table scope.
      const collaboratorScopedIds = new Set<string>();
      const identityPairs: { id: string; email: string }[] = [];
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
        for (const item of spec.itemsToValidate ?? normalized.items) {
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
          if (spec.requireCollaborator) {
            collaboratorScopedIds.add(idResult.value);
            if (
              typeof item.id === 'string' &&
              item.id !== 'me' &&
              item.id.length > 0 &&
              typeof item.email === 'string' &&
              item.email.length > 0
            ) {
              identityPairs.push({ id: item.id, email: item.email });
            }
          } else {
            strictIds.add(idResult.value);
          }
        }
      }

      // Trusted stored values remain separate from caller-supplied identity pairs.
      const strictUsersResult = yield* await service.userLookupService.listUsersByIds([
        ...strictIds,
      ]);
      const scopedUsersResult = yield* await service.userLookupService.listTableUsersByIdentifiers(
        tableId.toString(),
        [...collaboratorScopedIds, ...identifiers]
      );
      const pairedUsersResult =
        yield* await service.userLookupService.listUsersByIdentityPairs(identityPairs);

      const usersById = new Map<string, UserLookupRecord>();
      const pairedUsersById = new Map(pairedUsersResult.map((user) => [user.id, user]));
      const scopedUsersById = new Map<string, UserLookupRecord>();
      const scopedUsersByEmail = new Map<string, UserLookupRecord>();
      const scopedUsersByName = new Map<string, UserLookupRecord>();

      for (const user of strictUsersResult) {
        usersById.set(user.id, user);
      }
      for (const user of scopedUsersResult) {
        scopedUsersById.set(user.id, user);
        if (user.email) {
          scopedUsersByEmail.set(user.email, user);
        }
        scopedUsersByName.set(user.name, user);
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
          // v1 parity (UserFieldCore.convertStringToCellValue -> matchUser(cellValue[0])):
          // a single-user field only considers the first identifier, so
          // `"unknown, Lee"` clears the cell instead of falling back to a later
          // match. FieldToSpecVisitor already trims free-form input, but the spec
          // type is public and can be built directly, so enforce the rule here.
          const identifiersToResolve = spec.isMultiple
            ? spec.identifiers
            : spec.identifiers.slice(0, 1);
          for (const identifier of identifiersToResolve) {
            const keyResult = resolveIdentifier(String(identifier));
            if (keyResult.isErr()) {
              return err(keyResult.error);
            }
            const key = keyResult.value;
            const user =
              scopedUsersById.get(key) ?? scopedUsersByEmail.get(key) ?? scopedUsersByName.get(key);
            // v1 parity: free-form text that matches no collaborator clears
            // the cell instead of failing the whole write.
            if (!user) {
              continue;
            }
            resolvedItems.push(toUserItem(user));
          }

          const resolvedValue = spec.isMultiple ? resolvedItems : (resolvedItems[0] ?? null);
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

        for (const item of spec.itemsToValidate ?? normalized.items) {
          const idResult = resolveIdentifier(String(item.id));
          if (idResult.isErr()) {
            return err(idResult.error);
          }
          const id = idResult.value;
          let user: UserLookupRecord | undefined;
          if (!spec.requireCollaborator) {
            user = usersById.get(id);
          } else if (item.email !== undefined) {
            // Check the supplied tuple itself, not merely an ID verified by another item.
            const paired = pairedUsersById.get(id);
            if (
              typeof item.id === 'string' &&
              item.id !== 'me' &&
              item.id === id &&
              typeof item.email === 'string' &&
              paired?.email === item.email
            ) {
              user = paired;
            } else if (item.id === 'me') {
              const scoped = scopedUsersById.get(id);
              if (scoped?.email === item.email) user = scoped;
            }
          } else {
            user = scopedUsersById.get(id);
          }
          if (!user) {
            return err(
              domainError.validation({
                code: 'validation.field.user_not_found',
                message: 'User not found',
                localization: { i18nKey: sdkErrorI18nKeys.user.notFound },
              })
            );
          }
          resolvedItems.push(toUserItem(user));
        }

        const resolvedValue = normalized.isArray ? resolvedItems : (resolvedItems[0] ?? null);
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
