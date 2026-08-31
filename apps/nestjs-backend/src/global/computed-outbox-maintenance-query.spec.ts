import { describe, expect, it } from 'vitest';

import {
  buildComputedOutboxAnomalyListQuery,
  buildComputedOutboxDeadLetterBatchSelectionQuery,
  buildComputedOutboxLineageRunChainQuery,
  buildComputedOutboxLineageTaskLookupQuery,
  buildComputedOutboxOrphanedDeferralRestoreQuery,
  buildComputedOutboxRecoveryPlanHash,
  buildComputedOutboxRoutedFilter,
  buildComputedOutboxRunHistoryExistsQuery,
  buildComputedOutboxStaleRecoverySelectQuery,
  buildComputedOutboxTaskStatesQuery,
  buildComputedOutboxWakeupCandidatesQuery,
  normalizeComputedOutboxErrorSignature,
} from './computed-outbox-maintenance-query';

describe('buildComputedOutboxOrphanedDeferralRestoreQuery', () => {
  it('restores only far-future pending rows not covered by an active pause', () => {
    const query = buildComputedOutboxOrphanedDeferralRestoreQuery({ storage: 'default' }, 600_000);

    expect(query.sql).toContain('set next_run_at = now()');
    expect(query.sql).toContain("o.status = 'pending'");
    expect(query.sql).toContain("o.next_run_at > now() + (? * interval '1 millisecond')");
    // Rows still covered by an active pause keep their deferred schedule.
    expect(query.sql).toContain('not exists');
    expect(query.sql).toContain('cps.resume_at is null or cps.resume_at > now()');
    // Bases routed to a foreign data db stay untouched on default storage.
    expect(query.sql).toContain('space_data_db_binding');
    expect(query.bindings).toEqual([600_000]);
  });

  it('binds the base-space mapping for byodb targets', () => {
    const query = buildComputedOutboxOrphanedDeferralRestoreQuery(
      {
        storage: 'byodb',
        internalSchema: 'teable_internal',
        baseSpaceMapping: [{ baseId: 'bse-1', spaceId: 'spc-1' }],
      },
      600_000
    );

    expect(query.sql).toContain('"teable_internal"."computed_update_outbox"');
    expect(query.bindings[0]).toBe(600_000);
    expect(String(query.bindings[1])).toContain('bse-1');
  });
});

describe('buildComputedOutboxWakeupCandidatesQuery', () => {
  it('excludes every active pause scope and limits periodic scans to actionable work', () => {
    const query = buildComputedOutboxWakeupCandidatesQuery(
      { storage: 'default' },
      120_000,
      500,
      undefined,
      { actionableOnly: true }
    );

    expect(query.sql).toContain('not exists');
    expect(query.sql).toContain("cps.scope_type = 'base'");
    expect(query.sql).toContain("cps.scope_type = 'table'");
    expect(query.sql).toContain("cps.scope_type = 'space'");
    expect(query.sql).toContain('cps.resume_at > now()');
    expect(query.sql).toContain('o.next_run_at <= now()');
    expect(query.sql).toContain("o.locked_at <= now() - (? * interval '1 millisecond')");
    expect(query.sql).toContain('left join "base" as cb');
    expect(query.bindings).toEqual([120_000, 500]);
  });

  it('excludes tasks of externally bound spaces on the default storage', () => {
    const query = buildComputedOutboxWakeupCandidatesQuery({ storage: 'default' }, 120_000, 500);

    expect(query.sql).toContain('join "space_data_db_binding" as sdb');
    expect(query.sql).toContain(`sdb."mode" <> 'default'`);
  });

  it('does not add the foreign-binding exclusion on BYODB storages', () => {
    const query = buildComputedOutboxWakeupCandidatesQuery(
      {
        storage: 'byodb',
        internalSchema: 'teable_data',
        baseSpaceMapping: [],
      },
      120_000,
      500
    );

    expect(query.sql).not.toContain('space_data_db_binding');
  });

  it('uses the supplied base-to-space mapping for BYODB pause scopes', () => {
    const query = buildComputedOutboxWakeupCandidatesQuery(
      {
        storage: 'byodb',
        internalSchema: 'teable_data',
        baseSpaceMapping: [{ baseId: 'bse_a', spaceId: 'spc_a' }],
      },
      120_000,
      500
    );

    expect(query.sql).toContain('jsonb_to_recordset(?::jsonb)');
    expect(query.sql).toContain('from "teable_data"."computed_update_outbox" as o');
    expect(query.sql).toContain('from "teable_data"."computed_update_pause_scope" as cps');
    expect(query.bindings).toEqual(['[{"base_id":"bse_a","space_id":"spc_a"}]', 500]);
  });
});

describe('buildComputedOutboxRoutedFilter', () => {
  it('excludes bases already routed to a ready BYODB binding on the default storage', () => {
    const filter = buildComputedOutboxRoutedFilter({ storage: 'default' });

    expect(filter.cte).toContain('routed_away as (');
    expect(filter.cte).toContain("sdb.mode = 'byodb' and sdb.state = 'ready'");
    expect(filter.cte).toContain("dc.status = 'ready'");
    expect(filter.condition('base_id')).toBe('base_id not in (select base_id from routed_away)');
    expect(filter.bindings).toEqual([]);
  });

  it('keeps only bases in the current space bindings on a BYODB storage', () => {
    const filter = buildComputedOutboxRoutedFilter({
      storage: 'byodb',
      internalSchema: 'teable_data',
      baseSpaceMapping: [{ baseId: 'bse_a', spaceId: 'spc_a' }],
    });

    expect(filter.cte).toContain('routable as (');
    expect(filter.cte).toContain('jsonb_to_recordset(?::jsonb)');
    expect(filter.condition('o.base_id')).toBe('o.base_id in (select base_id from routable)');
    expect(filter.bindings).toEqual(['[{"base_id":"bse_a","space_id":"spc_a"}]']);
  });
});

describe('buildComputedOutboxTaskStatesQuery', () => {
  it('schema-qualifies BYODB ledger tables so lookup does not depend on search_path', () => {
    const query = buildComputedOutboxTaskStatesQuery(
      { storage: 'byodb', internalSchema: 'teable_data' },
      ['cuo-1', 'cuo-2']
    );

    expect(query.sql).toContain('from "teable_data"."computed_update_dead_letter"');
    expect(query.sql).toContain('from "teable_data"."computed_update_outbox"');
    expect(query.bindings).toEqual([
      ['cuo-1', 'cuo-2'],
      ['cuo-1', 'cuo-2'],
    ]);
  });

  it('quotes default-storage tables without an internal schema', () => {
    const query = buildComputedOutboxTaskStatesQuery({ storage: 'default' }, ['cuo-1']);

    expect(query.sql).toContain('from "computed_update_dead_letter"');
    expect(query.sql).toContain('from "computed_update_outbox"');
    expect(query.sql).not.toContain('teable_');
  });
});

describe('buildComputedOutboxAnomalyListQuery', () => {
  it('schema-qualifies BYODB anomaly tables and keeps the routed-base filter', () => {
    const query = buildComputedOutboxAnomalyListQuery(
      {
        storage: 'byodb',
        internalSchema: 'teable_data',
        baseSpaceMapping: [{ baseId: 'bse_a', spaceId: 'spc_a' }],
      },
      120_000,
      50
    );

    expect(query.sql).toContain('from "teable_data"."computed_update_dead_letter"');
    expect(query.sql).toContain('from "teable_data"."computed_update_outbox" as o');
    expect(query.sql).toContain('from "teable_data"."computed_update_pause_scope" as cps');
    expect(query.sql).toContain('base_id in (select base_id from routable)');
    expect(query.bindings).toEqual([
      '[{"base_id":"bse_a","space_id":"spc_a"}]',
      '[{"base_id":"bse_a","space_id":"spc_a"}]',
      120_000,
      50,
    ]);
  });
});

describe('buildComputedOutboxStaleRecoverySelectQuery', () => {
  it('schema-qualifies BYODB outbox and pause-scope tables', () => {
    const query = buildComputedOutboxStaleRecoverySelectQuery(
      {
        storage: 'byodb',
        internalSchema: 'teable_data',
        baseSpaceMapping: [{ baseId: 'bse_a', spaceId: 'spc_a' }],
      },
      'cuo-stale',
      120_000
    );

    expect(query.sql).toContain('from "teable_data"."computed_update_outbox" as o');
    expect(query.sql).toContain('from "teable_data"."computed_update_pause_scope" as cps');
    expect(query.bindings).toEqual([
      '[{"base_id":"bse_a","space_id":"spc_a"}]',
      'cuo-stale',
      120_000,
    ]);
  });
});

describe('buildComputedOutboxDeadLetterBatchSelectionQuery', () => {
  it('locks the entire exact problem group by id only in oldest-first order', () => {
    const query = buildComputedOutboxDeadLetterBatchSelectionQuery(
      { storage: 'byodb', internalSchema: 'teable_data' },
      {
        baseId: 'bse1',
        seedTableId: 'tbl1',
        errorSignature: 'statement timeout',
      }
    );

    expect(query.sql).toContain('select id as "taskId"');
    expect(query.sql).not.toContain('steps');
    expect(query.sql).toContain('from "teable_data"."computed_update_dead_letter"');
    expect(query.sql).toContain('base_id = ?');
    expect(query.sql).toContain('seed_table_id = ?');
    expect(query.sql).toContain(
      "regexp_replace(left(coalesce(last_error, ''), 500), '[0-9]+', '#', 'g') = ?"
    );
    expect(query.sql).toContain('order by failed_at asc, id asc');
    expect(query.sql).toContain('for update');
    expect(query.sql).not.toContain('limit ?');
    expect(query.sql).not.toContain('skip locked');
    expect(query.bindings).toEqual(['bse1', 'tbl1', 'statement timeout']);
  });

  it('normalizes a raw legacy signature so an older client still matches the group', () => {
    const query = buildComputedOutboxDeadLetterBatchSelectionQuery(
      { storage: 'default' },
      {
        baseId: 'bse1',
        seedTableId: 'tbl1',
        errorSignature:
          'Failed to create dirty table: error: could not create file "base/16385/t50_1262301": No space left on device',
      }
    );

    expect(query.bindings[2]).toBe(
      'Failed to create dirty table: error: could not create file "base/#/t#_#": No space left on device'
    );
  });
});

describe('normalizeComputedOutboxErrorSignature', () => {
  it('collapses digit runs so volatile numeric identifiers do not fragment groups', () => {
    expect(
      normalizeComputedOutboxErrorSignature('could not create file "base/16385/t50_1262301"')
    ).toBe('could not create file "base/#/t#_#"');
    expect(normalizeComputedOutboxErrorSignature(null)).toBe('');
  });

  it('keeps letter-based ids apart and stays idempotent', () => {
    const left = normalizeComputedOutboxErrorSignature('Field fld1Aa not found');
    const right = normalizeComputedOutboxErrorSignature('Field fld2Bb not found');
    expect(left).not.toBe(right);
    expect(normalizeComputedOutboxErrorSignature(left)).toBe(left);
  });

  it('truncates before collapsing, matching left(..., 500) in SQL', () => {
    const error = `${'9'.repeat(499)}ab`;
    expect(normalizeComputedOutboxErrorSignature(error)).toBe('#a');
  });
});

describe('buildComputedOutboxRecoveryPlanHash', () => {
  it('keeps equivalent recovered plans independently pending by task id', () => {
    expect(buildComputedOutboxRecoveryPlanHash('plan-a', 'cuo-1')).toBe(
      'plan-a:nolock:replay_cuo-1'
    );
    expect(buildComputedOutboxRecoveryPlanHash('plan-a:nolock:old', 'cuo-2')).toBe(
      'plan-a:nolock:replay_cuo-2'
    );
  });
});

describe('buildComputedOutboxLineageTaskLookupQuery', () => {
  it('unions the live, dead and history ledgers with a normalized projection', () => {
    const query = buildComputedOutboxLineageTaskLookupQuery({ storage: 'default' }, 'cuo123', true);

    expect(query.sql).toContain(`'live'::text as "source"`);
    expect(query.sql).toContain(`'dead'::text as "source"`);
    expect(query.sql).toContain(`'history'::text as "source"`);
    expect(query.sql).toContain('"computed_update_run_history"');
    // Spilled seeds count from the seed table only for live rows.
    expect(query.sql).toContain('"computed_update_outbox_seed"');
    expect(query.bindings).toEqual(['cuo123', 'cuo123', 'cuo123']);
  });

  it('skips the history arm when the ledger table is absent', () => {
    const query = buildComputedOutboxLineageTaskLookupQuery(
      { storage: 'default' },
      'cuo123',
      false
    );

    expect(query.sql).not.toContain('computed_update_run_history');
    expect(query.bindings).toEqual(['cuo123', 'cuo123']);
  });

  it('schema-qualifies byodb targets', () => {
    const query = buildComputedOutboxLineageTaskLookupQuery(
      { storage: 'byodb', internalSchema: 'teable_internal' },
      'cuo123',
      true
    );

    expect(query.sql).toContain('"teable_internal"."computed_update_outbox"');
    expect(query.sql).toContain('"teable_internal"."computed_update_dead_letter"');
    expect(query.sql).toContain('"teable_internal"."computed_update_run_history"');
  });
});

describe('buildComputedOutboxLineageRunChainQuery', () => {
  it('matches run lineage by run id and origin overlap, ordered by stage progress', () => {
    const query = buildComputedOutboxLineageRunChainQuery(
      { storage: 'default' },
      ['run-1', 'run-2'],
      true,
      200
    );

    expect(query.sql).toContain('t.run_id = any(?::text[])');
    expect(query.sql).toContain('t.origin_run_ids && ?::text[]');
    expect(query.sql).toContain('order by "runCompletedStepsBefore" asc');
    // 3 arms x (run ids, origin overlap) + limit
    expect(query.bindings).toHaveLength(7);
    expect(query.bindings.at(-1)).toBe(200);
  });

  it('clamps the chain limit', () => {
    const query = buildComputedOutboxLineageRunChainQuery(
      { storage: 'default' },
      ['run-1'],
      false,
      9999
    );
    expect(query.bindings.at(-1)).toBe(500);
  });
});

describe('buildComputedOutboxRunHistoryExistsQuery', () => {
  it('probes the schema-qualified regclass', () => {
    expect(
      buildComputedOutboxRunHistoryExistsQuery({
        storage: 'byodb',
        internalSchema: 'teable_internal',
      }).bindings
    ).toEqual(['teable_internal.computed_update_run_history']);
    expect(buildComputedOutboxRunHistoryExistsQuery({ storage: 'default' }).bindings).toEqual([
      'computed_update_run_history',
    ]);
  });
});
