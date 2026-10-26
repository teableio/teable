import { describe, expect, it } from 'vitest';

import {
  AUTO_FALLBACK_QUERY_ID_ATTRIBUTE,
  AUTO_FALLBACK_REASON_ATTRIBUTE,
  autoFallbackAttributes,
} from './auto-fallback-telemetry';

describe('autoFallbackAttributes', () => {
  it('records the structured executor error code and query id for an automatic fallback', () => {
    expect(
      autoFallbackAttributes({
        plannedMode: 'structured',
        fallback: true,
        reason: 'data_query.unsupported_join',
        queryId: 'orders_report',
      })
    ).toEqual({
      [AUTO_FALLBACK_REASON_ATTRIBUTE]: 'data_query.unsupported_join',
      [AUTO_FALLBACK_QUERY_ID_ATTRIBUTE]: 'orders_report',
    });
  });

  it('omits the query id when the caller did not supply a usable one', () => {
    expect(
      autoFallbackAttributes({
        plannedMode: 'structured',
        fallback: true,
        reason: 'data_query.unsupported_window',
        queryId: 'not valid id',
      })
    ).toEqual({ [AUTO_FALLBACK_REASON_ATTRIBUTE]: 'data_query.unsupported_window' });
  });

  it('keeps an automatic fallback visible when the reason header is missing', () => {
    expect(autoFallbackAttributes({ plannedMode: 'structured', fallback: true })).toEqual({
      [AUTO_FALLBACK_REASON_ATTRIBUTE]: 'unknown',
    });
  });

  it('never exports arbitrary request text as the reason', () => {
    for (const reason of [
      'SELECT "secret" FROM "bse"."tbl"',
      'unsupported_join',
      'data_query.',
      `data_query.${'x'.repeat(65)}`,
      'data_query.unsupported_join; DROP TABLE users',
    ]) {
      expect(autoFallbackAttributes({ plannedMode: 'structured', fallback: true, reason })).toEqual(
        { [AUTO_FALLBACK_REASON_ATTRIBUTE]: 'unknown' }
      );
    }
  });

  it('does not report SQL by design as an automatic fallback', () => {
    expect(
      autoFallbackAttributes({
        plannedMode: 'sql-query',
        fallback: false,
        reason: 'sql_query_by_design',
        queryId: 'sql_only',
      })
    ).toEqual({});
  });

  it('does not report a planned-structured request that did not use the fallback', () => {
    expect(
      autoFallbackAttributes({
        plannedMode: 'structured',
        fallback: false,
        reason: 'sql_query_by_design',
        queryId: 'planned',
      })
    ).toEqual({});
  });
});
