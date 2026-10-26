import type { IComplexityService } from '@teable/v2-command-explain';
import { buildComplexityAssessment, buildSchemaComplexityProfile } from '@teable/v2-complexity';
import { domainError, type IExecutionContext } from '@teable/v2-core';
import { err, ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { executeComplexityAssessEndpoint } from './assess';

const context = {} as IExecutionContext;

const createProfile = () =>
  buildSchemaComplexityProfile({
    fields: [
      { id: 'fldA', tableId: 'tblA', type: 'text', isComputed: false },
      { id: 'fldB', tableId: 'tblA', type: 'formula', isComputed: true },
    ],
    edges: [
      {
        fromFieldId: 'fldA',
        toFieldId: 'fldB',
        fromTableId: 'tblA',
        toTableId: 'tblA',
        kind: 'same_record',
      },
    ],
    completeness: 'complete',
  });

describe('executeComplexityAssessEndpoint', () => {
  it('returns profile and assessment on success', async () => {
    const profile = createProfile();
    const assessment = buildComplexityAssessment(profile);
    const service = {
      assess: vi.fn(async () => ok({ profile, assessment })),
    } as unknown as IComplexityService;

    const result = await executeComplexityAssessEndpoint(
      context,
      { tableId: 'tblA', includeCatalogStats: false },
      service
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, data: { profile, assessment } });
    expect(service.assess).toHaveBeenCalledOnce();
  });

  it('maps a domain validation error to HTTP 400', async () => {
    const service = {
      assess: vi.fn(async () =>
        err(domainError.validation({ message: 'Provide exactly one of tableId or schema' }))
      ),
    } as unknown as IComplexityService;

    const result = await executeComplexityAssessEndpoint(
      context,
      { tableId: 'tblA', includeCatalogStats: false },
      service
    );

    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({
      ok: false,
      error: { code: 'validation.invalid' },
    });
  });
});
