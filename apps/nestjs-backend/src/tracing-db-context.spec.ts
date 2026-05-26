import { describe, expect, it, vi } from 'vitest';
import {
  resolveTeableDbTraceContext,
  setTeableDbSpanAttributes,
  setTeableDbSpanAttributesFromSpan,
} from './tracing-db-context';

describe('tracing db context', () => {
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
