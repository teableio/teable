import type { UniqueIdentifier } from '@dnd-kit/core';
import type { Record as IRecord } from '@teable/sdk/model';

export type ICardMap = Record<UniqueIdentifier, IRecord[]>;
