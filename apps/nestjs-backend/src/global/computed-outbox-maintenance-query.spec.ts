import { describe, expect, it } from 'vitest';

import { buildComputedOutboxWakeupCandidatesQuery } from './computed-outbox-maintenance-query';

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

  it('uses the supplied base-to-space mapping for BYODB pause scopes', () => {
    const query = buildComputedOutboxWakeupCandidatesQuery(
      {
        storage: 'byodb',
        baseSpaceMapping: [{ baseId: 'bse_a', spaceId: 'spc_a' }],
      },
      120_000,
      500
    );

    expect(query.sql).toContain('jsonb_to_recordset(?::jsonb)');
    expect(query.bindings).toEqual(['[{"base_id":"bse_a","space_id":"spc_a"}]', 500]);
  });
});
