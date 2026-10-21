/* eslint-disable @typescript-eslint/naming-convention */
// Span attribute names in this spec are OTel semantic-convention strings.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  resolveDatabaseInstanceFromSpanAttributes,
  resolveDatabaseInstanceId,
  UNKNOWN_DATABASE_INSTANCE_ID,
} from './database-instance';

describe('database instance identity', () => {
  it('matches the collector contract byte for byte', () => {
    const expected = `dbh_${createHash('sha256')
      .update('teable.db.instance.v1|db.example.com|5432')
      .digest('hex')
      .slice(0, 20)}`;

    expect(resolveDatabaseInstanceId({ host: 'db.example.com', port: 5432 })).toBe(expected);
    expect(resolveDatabaseInstanceId({ host: 'DB.Example.COM', port: '5432' })).toBe(expected);
  });

  it('is stable per endpoint and separates endpoints that differ by port', () => {
    const primary = resolveDatabaseInstanceId({ host: 'db.example.com', port: 5432 });
    expect(resolveDatabaseInstanceId({ host: 'db.example.com', port: 5432 })).toBe(primary);
    expect(resolveDatabaseInstanceId({ host: 'db.example.com' })).toBe(primary);
    expect(resolveDatabaseInstanceId({ host: 'db.example.com', port: '' })).toBe(primary);
    expect(resolveDatabaseInstanceId({ host: 'db.example.com', port: 6543 })).not.toBe(primary);
    expect(resolveDatabaseInstanceId({ host: 'other.example.com', port: 5432 })).not.toBe(primary);
  });

  it('is opaque: no host, port, database, user or password text survives in the id', () => {
    const id = resolveDatabaseInstanceId({
      host: 'aws-1-us-west-2.pooler.supabase.com',
      port: 5432,
    });

    expect(id).toMatch(/^dbh_[0-9a-f]{20}$/);
    expect(id).not.toContain('supabase');
    expect(id).not.toContain('5432');
  });

  it('falls back to a documented unknown id instead of crashing without an endpoint', () => {
    expect(resolveDatabaseInstanceId({})).toBe(UNKNOWN_DATABASE_INSTANCE_ID);
    expect(resolveDatabaseInstanceId({ host: '   ', port: 5432 })).toBe(
      UNKNOWN_DATABASE_INSTANCE_ID
    );
    expect(resolveDatabaseInstanceId({ host: 1234 })).toBe(UNKNOWN_DATABASE_INSTANCE_ID);
  });

  it('reads stable and legacy span attribute names', () => {
    const stable = resolveDatabaseInstanceFromSpanAttributes({
      'server.address': 'db.example.com',
      'server.port': 6543,
    });
    expect(stable).toBe(resolveDatabaseInstanceId({ host: 'db.example.com', port: 6543 }));
    expect(
      resolveDatabaseInstanceFromSpanAttributes({
        'net.peer.name': 'db.example.com',
        'net.peer.port': '6543',
      })
    ).toBe(stable);
    expect(resolveDatabaseInstanceFromSpanAttributes({})).toBe(UNKNOWN_DATABASE_INSTANCE_ID);
  });
});
