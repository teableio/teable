import { describe, expect, it } from 'vitest';

import {
  explainResultContainsSecret,
  projectExplainPlanDocument,
  projectExplainPlanNode,
} from './DataQueryExplain';
import { queryExplainResultSchema } from './DataQueryExplain';

const genericDocument = [
  {
    Plan: {
      'Node Type': 'Limit',
      'Startup Cost': 0.01,
      'Total Cost': 12.5,
      'Plan Rows': 10,
      'Plan Width': 64,
      'Relation Name': 'secret_table',
      'Index Name': 'secret_index',
      Filter: "(title = $1) AND (tenant_id = 'policy-tenant')",
      Output: ['title', 'hidden_column'],
      Plans: [
        {
          'Node Type': 'Seq Scan',
          'Relation Name': 'secret_table',
          'Index Cond': '(id = $2)',
          'Sort Key': ['masked_expression'],
          'Startup Cost': 0,
          'Total Cost': 10,
          'Plan Rows': 100,
          'Plan Width': 32,
        },
      ],
    },
  },
];

describe('explain plan projection', () => {
  it('keeps only node shape, estimates and safe labels', () => {
    const plan = projectExplainPlanDocument(genericDocument, 'generic');
    expect(plan).toMatchObject({
      mode: 'generic',
      analyzed: false,
      format: 'json',
      scope: 'caller',
      root: {
        nodeType: 'Limit',
        startupCost: 0.01,
        totalCost: 12.5,
        planRows: 10,
        planWidth: 64,
        children: [{ nodeType: 'Seq Scan', totalCost: 10 }],
      },
    });
    const text = JSON.stringify(plan);
    for (const leaked of [
      'secret_table',
      'secret_index',
      'Filter',
      'Index Cond',
      'Sort Key',
      'hidden_column',
      'policy-tenant',
      'masked_expression',
    ]) {
      expect(text).not.toContain(leaked);
    }
  });

  it('degrades an unrecognized document instead of returning raw planner JSON', () => {
    expect(projectExplainPlanDocument({ Plan: { Filter: 'x' } }, 'structural')).toEqual({
      mode: 'unavailable',
      analyzed: false,
      format: 'json',
      scope: 'caller',
    });
    expect(projectExplainPlanNode({ 'Node Type': 'x'.repeat(100) })).toBeUndefined();
  });

  it('detects a bind value in the scanned plan projection', () => {
    expect(explainResultContainsSecret({ root: { nodeType: 'Filter $1' } }, ['$1'])).toBe(true);
    expect(explainResultContainsSecret({ nodeType: 'Seq Scan', planRows: 10 }, ['name'])).toBe(
      false
    );
  });

  it('does not flag a parameter name that equals a common alias', () => {
    expect(
      explainResultContainsSecret({ nodeType: 'Seq Scan', planRows: 10 }, ['name', 'title'])
    ).toBe(false);
  });
});

describe('explain response contract', () => {
  const valid = {
    sql: 'select "t"."title" as "title" from "s"."t" as "t" where "t"."title" = $1 limit $2',
    sqlScope: 'caller',
    hostScope: { rowScope: 'applied', fieldScope: 'applied', fieldMaskCount: 0 },
    parameters: {
      order: ['needle', 'limit'],
      orderKind: 'declaration',
      redaction: 'bind-values-hidden',
      bindCount: 2,
      definitions: [{ name: 'needle', type: 'string', nullable: false }],
    },
    plan: {
      mode: 'generic',
      analyzed: false,
      format: 'json',
      scope: 'caller',
      root: { nodeType: 'Limit', totalCost: 1, children: [{ nodeType: 'Seq Scan' }] },
    },
    timing: { planningMs: 1.2, totalMs: 1.4 },
  };

  it('accepts the caller-scoped envelope', () => {
    expect(queryExplainResultSchema.parse(valid)).toEqual(valid);
  });

  it('rejects full-scope or analyzed responses', () => {
    expect(queryExplainResultSchema.safeParse({ ...valid, sqlScope: 'full' }).success).toBe(false);
    expect(
      queryExplainResultSchema.safeParse({
        ...valid,
        plan: { ...valid.plan, analyzed: true, mode: 'actual' },
      }).success
    ).toBe(false);
  });
});
