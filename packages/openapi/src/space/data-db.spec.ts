import { describe, expect, it } from 'vitest';
import { createSpaceRoSchema } from './create';
import {
  dataDbConnectionSummaryVoSchema,
  dataDbPreflightRoSchema,
  dataDbPreflightVoSchema,
} from './data-db';

describe('space data DB schemas', () => {
  it('accepts a BYODB preflight request', () => {
    const result = dataDbPreflightRoSchema.safeParse({
      url: 'postgresql://teable:secret@example.com:5432/teable_data',
      internalSchema: 'teable_meta_test',
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data.targetMode).toBe('initialize-empty');
  });

  it('accepts the create-space BYODB extension', () => {
    const result = createSpaceRoSchema.safeParse({
      name: 'BYODB Space',
      dataDb: {
        mode: 'byodb',
        url: 'postgresql://teable:secret@example.com:5432/teable_data',
        targetMode: 'initialize-empty',
      },
    });

    expect(result.success).toBe(true);
  });

  it('rejects an unknown create-space data DB mode', () => {
    const result = createSpaceRoSchema.safeParse({
      name: 'BYODB Space',
      dataDb: {
        mode: 'external',
      },
    });

    expect(result.success).toBe(false);
  });

  it('keeps preflight output structured and secret-free', () => {
    const result = dataDbPreflightVoSchema.parse({
      ok: true,
      provider: 'postgres',
      maskedUrl: 'postgresql://teable:***@example.com:5432/teable_data',
      urlFingerprint: 'dbfp_123',
      displayHost: 'example.com:5432',
      displayDatabase: 'teable_data',
      internalSchema: 'teable_meta_test',
      serverVersion: '14.12',
      classification: 'empty',
      availableDatabases: ['postgres', 'teable_data'],
      requiresDatabaseSelection: false,
      capabilities: {
        createSchema: true,
        createTable: true,
        createFunction: true,
        createTrigger: true,
        createRole: false,
        grantPrivileges: true,
        inspectActivity: true,
      },
      errors: [],
    });

    expect(result.maskedUrl).not.toContain('secret');
    expect(result.availableDatabases).toEqual(['postgres', 'teable_data']);
    expect(result.requiresDatabaseSelection).toBe(false);
  });

  it('accepts a default space data DB summary', () => {
    expect(
      dataDbConnectionSummaryVoSchema.parse({
        mode: 'default',
        state: 'ready',
      })
    ).toEqual({
      mode: 'default',
      state: 'ready',
    });
  });

  it('accepts a BYODB summary with schema version metadata', () => {
    expect(
      dataDbConnectionSummaryVoSchema.parse({
        mode: 'byodb',
        state: 'ready',
        provider: 'postgres',
        displayHost: 'example.com:5432',
        displayDatabase: 'teable_data',
        internalSchema: 'teable_meta_test',
        schemaVersion: '20260421000000_init_data_db_baseline',
        lastValidatedAt: '2026-05-06T00:00:00.000Z',
      })
    ).toMatchObject({
      mode: 'byodb',
      schemaVersion: '20260421000000_init_data_db_baseline',
    });
  });
});
