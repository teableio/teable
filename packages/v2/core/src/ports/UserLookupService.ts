import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';

export interface UserLookupRecord {
  id: string;
  name: string;
  email: string | null;
  avatarUrl?: string | null;
}

export interface IUserLookupService {
  /**
   * Resolve identifiers (id / name / email) to users, constrained to
   * collaborators of the given table's base or space. Mirrors v1 typecast
   * semantics: values that don't match a table collaborator resolve to nothing.
   */
  listTableUsersByIdentifiers(
    tableId: string,
    identifiers: ReadonlyArray<string>
  ): Promise<Result<ReadonlyArray<UserLookupRecord>, DomainError>>;

  /**
   * Primary-key lookup by user id, without collaborator scoping. Used to
   * validate structured user values on write and to enrich ids already stored
   * in cells for display — never for resolving free-form input into user
   * values. Deleted users are excluded by default; display enrichment passes
   * `includeDeleted` so historical cells keep their owner names.
   */
  listUsersByIds(
    ids: ReadonlyArray<string>,
    options?: { includeDeleted?: boolean }
  ): Promise<Result<ReadonlyArray<UserLookupRecord>, DomainError>>;
}
