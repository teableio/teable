import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { buildOperation, validateComplexityAssessInput } from './assess';

const run = async <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromiseExit(effect);

describe('complexity assess CLI parsing', () => {
  it('builds a compact operation from a kind and changed fields', async () => {
    const exit = await run(buildOperation('update', 'tblA', 'fldA, fldB'));
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toEqual({
        kind: 'update',
        tableId: 'tblA',
        changedFieldIds: ['fldA', 'fldB'],
      });
    }
  });

  it('accepts a raw schema without a table', async () => {
    const exit = await run(
      validateComplexityAssessInput({
        schema: {
          fields: [{ id: 'fldA', tableId: 'tblA', type: 'text', isComputed: false }],
          edges: [],
        },
      })
    );
    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it('rejects source and assumption misuse', async () => {
    const noSource = await run(validateComplexityAssessInput({}));
    const both = await run(
      validateComplexityAssessInput({
        tableId: 'tblA',
        schema: { fields: [], edges: [] },
      })
    );
    const assumptionsOnly = await run(
      validateComplexityAssessInput({
        tableId: 'tblA',
        assumptions: { seedRecordCount: 1 },
      })
    );
    const catalogWithoutTable = await run(
      validateComplexityAssessInput({
        schema: { fields: [], edges: [] },
        includeCatalogStats: true,
      })
    );

    expect(Exit.isFailure(noSource)).toBe(true);
    expect(Exit.isFailure(both)).toBe(true);
    expect(Exit.isFailure(assumptionsOnly)).toBe(true);
    expect(Exit.isFailure(catalogWithoutTable)).toBe(true);
  });
});
