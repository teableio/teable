import { IdPrefix } from '@teable/core';
import type { CreateOp, DeleteOp, EditOp } from 'sharedb';
import type { IQueryPollSkipStrategy } from '../interface';
import { recordQueryPollDecision } from '../metrics/query-poll-skip-metrics';
import { RecordQueryPollSkipStrategy } from './record-query-poll-skip.strategy';

// one strategy per subscribed doc type; a subscription type without a
// strategy always polls
const strategies: Partial<Record<IdPrefix, IQueryPollSkipStrategy>> = {
  [IdPrefix.Record]: new RecordQueryPollSkipStrategy(),
};

/**
 * Entry point used by ShareDbAdapter.skipPoll. Common guards live here;
 * doc-type specific reasoning is delegated to the matching strategy.
 * Decisions are observed via aggregated otel counters (each decision is
 * counted exactly once, either here or inside the strategy).
 */
export const shouldSkipQueryPoll = (
  collection: string,
  id: string,
  op: CreateOp | DeleteOp | EditOp,
  query: unknown
): boolean => {
  if (op.create || op.del) return recordQueryPollDecision(false, 'create_or_delete');
  if (!op.op) return recordQueryPollDecision(true, 'no_component_ops');
  const [docType] = collection.split('_');
  const strategy = strategies[docType as IdPrefix];
  if (!strategy) return recordQueryPollDecision(false, 'no_strategy');
  return strategy.shouldSkip(collection, id, op.op, query);
};
