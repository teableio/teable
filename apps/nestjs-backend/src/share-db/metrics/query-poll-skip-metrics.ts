import { metrics } from '@opentelemetry/api';

// Lives alongside RealtimeMetricsService so every realtime.* metric definition
// is discoverable in one folder. Kept standalone (not a method on the
// @Injectable service) on purpose: skipPoll's dispatch in query-poll-skip/ is a
// pure hot path, not a Nest provider, so it cannot inject the service.
//
// skipPoll fires per (op x subscription) — hundreds of thousands of times a
// day — so decisions are observed via aggregated counters only; per-event
// logging at this rate is not acceptable.
const meter = metrics.getMeter('teable-observability');

const decisionsTotal = meter.createCounter('realtime.query_poll.decisions.total', {
  description: 'ShareDB query poll skip decisions, labeled by decision and reason',
});

export type IQueryPollDecisionReason =
  // entry-level guards
  | 'create_or_delete'
  | 'no_component_ops'
  | 'no_strategy'
  // record strategy reasons
  | 'unanalyzable_op'
  | 'row_order_same_view'
  | 'row_order_other_view_only'
  | 'view_bound_query'
  | 'unbounded_query'
  | 'fields_relevant'
  | 'fields_irrelevant'
  | 'field_options_relevant'
  | 'field_options_irrelevant';

export const recordQueryPollDecision = (
  skip: boolean,
  reason: IQueryPollDecisionReason
): boolean => {
  decisionsTotal.add(1, { decision: skip ? 'skip' : 'poll', reason });
  return skip;
};
