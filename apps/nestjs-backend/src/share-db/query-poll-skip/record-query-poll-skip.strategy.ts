import type { IFilter, IOtOperation } from '@teable/core';
import {
  collectQueryFieldIds,
  extractFieldIdsFromFilter,
  IdPrefix,
  RecordOpBuilder,
} from '@teable/core';
import type { IGetRecordsRo } from '@teable/openapi';
import { ROW_ORDER_FIELD_PREFIX } from '../../features/view/constant';
import type { IQueryPollSkipStrategy } from '../interface';
import { recordQueryPollDecision } from '../metrics/query-poll-skip-metrics';

type ISubscriptionRecordQuery = IGetRecordsRo & { recordReadFilter?: IFilter };

/**
 * Record query subscriptions receive, besides record ops, field options ops
 * forwarded by ShareDbService.forwardToRecordChannel; those carry the source
 * doc id in op.d (passed here as id), which narrows the affected
 * subscriptions.
 */
export class RecordQueryPollSkipStrategy implements IQueryPollSkipStrategy {
  shouldSkip(collection: string, id: string, ops: IOtOperation[], query: unknown): boolean {
    const recordQuery = query as ISubscriptionRecordQuery | null | undefined;
    if (!recordQuery) return recordQueryPollDecision(false, 'unbounded_query');

    if (typeof id === 'string' && id.startsWith(IdPrefix.Field)) {
      return this.skipForwardedFieldOp(id, recordQuery);
    }
    return this.skipRecordOp(ops, recordQuery);
  }

  // forwarded field options op: options shape result semantics (e.g. select
  // choice order drives sorting), so only queries referencing the field care
  private skipForwardedFieldOp(fieldId: string, recordQuery: ISubscriptionRecordQuery): boolean {
    if (recordQuery.viewId && !recordQuery.ignoreViewQuery) {
      return recordQueryPollDecision(false, 'view_bound_query');
    }
    const queryFieldIds = this.collectSubscriptionFieldIds(recordQuery);
    if (!queryFieldIds) return recordQueryPollDecision(false, 'unbounded_query');
    return queryFieldIds.has(fieldId)
      ? recordQueryPollDecision(false, 'field_options_relevant')
      : recordQueryPollDecision(true, 'field_options_irrelevant');
  }

  private skipRecordOp(ops: IOtOperation[], recordQuery: ISubscriptionRecordQuery): boolean {
    const modified = this.extractModifiedFields(ops);
    if (!modified) return recordQueryPollDecision(false, 'unanalyzable_op');
    const { fieldIds, rowOrderViewIds } = modified;

    // the row order pseudo column only feeds the base ordering of queries on
    // the same view (inlined or not — both ride the view's manual order)
    if (recordQuery.viewId && rowOrderViewIds.has(recordQuery.viewId)) {
      return recordQueryPollDecision(false, 'row_order_same_view');
    }
    if (fieldIds.size === 0) {
      // an op with no analyzable path must conservatively poll
      return rowOrderViewIds.size > 0
        ? recordQueryPollDecision(true, 'row_order_other_view_only')
        : recordQueryPollDecision(false, 'unanalyzable_op');
    }

    // a viewId query depends on the view's server-side filter/sort, whose
    // fields are not visible here, so it must always poll. This guard must stay
    // AFTER the row-order checks above: hoisting it (or merging it with the
    // identical guard in skipForwardedFieldOp) would turn the
    // 'row_order_other_view_only' skip into a poll for every view-bound query
    if (recordQuery.viewId && !recordQuery.ignoreViewQuery) {
      return recordQueryPollDecision(false, 'view_bound_query');
    }

    const queryFieldIds = this.collectSubscriptionFieldIds(recordQuery);
    if (!queryFieldIds) return recordQueryPollDecision(false, 'unbounded_query');

    for (const fieldId of fieldIds) {
      if (queryFieldIds.has(fieldId)) {
        return recordQueryPollDecision(false, 'fields_relevant');
      }
    }
    return recordQueryPollDecision(true, 'fields_irrelevant');
  }

  // subscribers may attach their authority-matrix read filter; rows enter or
  // leave their visible set when its fields change, so those fields are
  // relevant too. Advisory only: read enforcement never relies on it
  private collectSubscriptionFieldIds(recordQuery: ISubscriptionRecordQuery): Set<string> | null {
    const queryFieldIds = collectQueryFieldIds(recordQuery);
    if (!queryFieldIds) return null;
    for (const fieldId of extractFieldIdsFromFilter(recordQuery.recordReadFilter, true)) {
      queryFieldIds.add(fieldId);
    }
    return queryFieldIds;
  }

  // Returns null when the op touches a path that is neither a plain field
  // value nor a row order pseudo column (fields.__row_<viewId>), meaning the
  // op may affect query order/membership in ways field analysis cannot see.
  private extractModifiedFields(
    ops: IOtOperation[]
  ): { fieldIds: Set<string>; rowOrderViewIds: Set<string> } | null {
    const fieldIds = new Set<string>();
    const rowOrderViewIds = new Set<string>();
    const rowOrderPrefix = `${ROW_ORDER_FIELD_PREFIX}_`;
    for (const subOp of ops) {
      // any non-field path may affect membership/order in ways field analysis
      // cannot see, so bail to a conservative poll rather than ignoring it
      if (subOp.p?.[0] !== 'fields') return null;
      // core's SetRecordBuilder owns the ['fields', fieldId] op path schema
      const fieldId = RecordOpBuilder.editor.setRecord.detect(subOp)?.fieldId;
      if (typeof fieldId !== 'string') return null;
      if (fieldId.startsWith(IdPrefix.Field)) {
        fieldIds.add(fieldId);
      } else if (fieldId.startsWith(rowOrderPrefix)) {
        rowOrderViewIds.add(fieldId.slice(rowOrderPrefix.length));
      } else {
        return null;
      }
    }
    return { fieldIds, rowOrderViewIds };
  }
}
