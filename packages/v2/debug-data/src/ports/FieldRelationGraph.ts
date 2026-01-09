import type { BaseId, DomainError } from '@teable/v2-core';
import type { Result } from 'neverthrow';

import type { DebugFieldRelationEdge } from '../types';

export type DebugFieldRelationGraphFieldMeta = {
  id: string;
  tableId: string;
  type: string;
  isComputed: boolean;
  isLookup: boolean;
};

export type DebugFieldRelationGraphData = {
  fieldsById: Map<string, DebugFieldRelationGraphFieldMeta>;
  edges: ReadonlyArray<DebugFieldRelationEdge>;
};

export interface IDebugFieldRelationGraph {
  load(baseId: BaseId): Promise<Result<DebugFieldRelationGraphData, DomainError>>;
}
