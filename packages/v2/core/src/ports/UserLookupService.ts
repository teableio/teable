import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';

export interface UserLookupRecord {
  id: string;
  name: string;
  email: string | null;
}

export interface IUserLookupService {
  listUsersByIdentifiers(
    identifiers: ReadonlyArray<string>
  ): Promise<Result<ReadonlyArray<UserLookupRecord>, DomainError>>;
}
