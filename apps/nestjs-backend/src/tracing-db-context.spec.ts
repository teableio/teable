/* eslint-disable @typescript-eslint/naming-convention */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  parseDatabaseUrl,
  parseDatabaseUrlCache,
  resolveTeableDbTraceContext,
  setTeableDbSpanAttributes,
  setTeableDbSpanAttributesFromSpan,
} from './tracing-db-context';

describe('parseDatabaseUrl memoization', () => {
  beforeEach(() => {
    parseDatabaseUrlCache.clear();
  });

  it('returns the same object reference for repeated calls', () => {
    const url = 'postgresql://user:pass@host:5432/db';
    const a = parseDatabaseUrl(url);
    const b = parseDatabaseUrl(url);
    expect(a).toBe(b);
    expect(a).toEqual({
      database: 'db',
      host: 'host',
      port: 5432,
      user: 'user',
      url: 'postgresql://user@host:5432/db',
    });
  });

  it('does not cache unparseable URLs', () => {
    expect(parseDatabaseUrl('not-a-url')).toBeUndefined();
    expect(parseDatabaseUrlCache.has('not-a-url')).toBe(false);
    expect(parseDatabaseUrl('not-a-url')).toBeUndefined();
  });

  it('does not cache when input is falsy', () => {
    expect(parseDatabaseUrl(undefined)).toBeUndefined();
    expect(parseDatabaseUrl('')).toBeUndefined();
    expect(parseDatabaseUrlCache.size).toBe(0);
  });

  it('evicts least-recently-used entries at capacity', () => {
    for (let i = 0; i < 100; i++) {
      parseDatabaseUrl(`postgresql://u:p@host${i}:5432/db`);
    }
    expect(parseDatabaseUrlCache.size).toBe(100);

    parseDatabaseUrl('postgresql://u:p@host-overflow:5432/db');
    expect(parseDatabaseUrlCache.size).toBe(100);
    expect(parseDatabaseUrlCache.has('postgresql://u:p@host0:5432/db')).toBe(false);
    expect(parseDatabaseUrlCache.has('postgresql://u:p@host-overflow:5432/db')).toBe(true);
  });
});

describe('tracing db context', () => {
  beforeEach(() => {
    parseDatabaseUrlCache.clear();
  });

  const env = {
    PRISMA_DATABASE_URL: 'postgresql://postgres:secret@meta.example.test:5433/teable',
  };

  it('marks connections matching the meta URL as meta and redacts the password', () => {
    expect(
      resolveTeableDbTraceContext(
        {
          database: 'teable',
          host: 'meta.example.test',
          port: 5433,
          user: 'postgres',
        },
        env
      )
    ).toEqual({
      role: 'meta',
      source: 'PRISMA_DATABASE_URL',
      url: 'postgresql://postgres@meta.example.test:5433/teable',
    });
  });

  it('marks non-meta postgres connections as dynamic data DB connections', () => {
    expect(
      resolveTeableDbTraceContext(
        {
          database: 'postgres',
          host: 'byodb.example.test',
          port: 5544,
          user: 'postgres',
        },
        env
      )
    ).toEqual({
      role: 'data',
      source: 'inferred.non_meta_postgres',
      url: 'postgresql://postgres@byodb.example.test:5544/postgres',
    });
  });

  it('writes teable db attributes to query spans', () => {
    const span = { setAttribute: vi.fn() };

    setTeableDbSpanAttributes(
      span,
      {
        database: 'teable',
        host: 'meta.example.test',
        port: 5433,
        user: 'postgres',
      },
      env
    );

    expect(span.setAttribute).toHaveBeenCalledWith('teable.db.role', 'meta');
    expect(span.setAttribute).toHaveBeenCalledWith(
      'teable.db.url',
      'postgresql://postgres@meta.example.test:5433/teable'
    );
    expect(span.setAttribute).toHaveBeenCalledWith('teable.db.source', 'PRISMA_DATABASE_URL');
  });

  it('writes teable db attributes to connection spans from existing span attributes', () => {
    const span = {
      attributes: {
        'db.name': 'teable_data',
        'db.user': 'postgres',
        'net.peer.name': 'data.example.test',
        'net.peer.port': 5434,
      },
      setAttribute: vi.fn(),
    };

    setTeableDbSpanAttributesFromSpan(span, env);

    expect(span.setAttribute).toHaveBeenCalledWith('teable.db.role', 'data');
    expect(span.setAttribute).toHaveBeenCalledWith(
      'teable.db.url',
      'postgresql://postgres@data.example.test:5434/teable_data'
    );
    expect(span.setAttribute).toHaveBeenCalledWith(
      'teable.db.source',
      'inferred.non_meta_postgres'
    );
  });
});
