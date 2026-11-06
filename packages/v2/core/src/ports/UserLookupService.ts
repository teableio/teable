import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';

export interface UserLookupRecord {
  id: string;
  name: string;
  email: string | null;
  avatarUrl?: string | null;
}
export interface UserIdentityPair {
  id: string;
  email: string;
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

  /** Resolve only exact id/email pairs belonging to the same active user. */
  listUsersByIdentityPairs(
    pairs: ReadonlyArray<UserIdentityPair>
  ): Promise<Result<ReadonlyArray<UserLookupRecord>, DomainError>>;

  /**
   * Primary-key lookup by user id, without collaborator scoping. Used only for
   * server-trusted existing values and display enrichment, never caller-controlled
   * input. Deleted users are excluded by default; display enrichment passes
   * `includeDeleted` so historical cells retain their owner names.
   */
  listUsersByIds(
    ids: ReadonlyArray<string>,
    options?: { includeDeleted?: boolean }
  ): Promise<Result<ReadonlyArray<UserLookupRecord>, DomainError>>;
}
