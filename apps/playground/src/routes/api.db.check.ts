import { createFileRoute } from '@tanstack/react-router';
import { createV2PostgresDb } from '@teable/v2-adapter-db-postgres-pg';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';

type CheckRequestBody = {
  connectionString?: unknown;
};

const toConnectionString = async (request: Request): Promise<string | null> => {
  try {
    const body = (await request.json()) as CheckRequestBody;
    return typeof body.connectionString === 'string' ? body.connectionString.trim() : null;
  } catch {
    return null;
  }
};

const isValidConnectionString = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'postgres:' || url.protocol === 'postgresql:';
  } catch {
    return false;
  }
};

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

async function handleCheck({ request }: { request: Request }) {
  const connectionString = await toConnectionString(request);
  if (!connectionString) {
    return jsonResponse({ ok: false, error: 'Missing connection string.' }, 400);
  }
  if (!isValidConnectionString(connectionString)) {
    return jsonResponse({ ok: false, error: 'Use a postgres:// or postgresql:// URL.' }, 400);
  }

  let db: Kysely<unknown> | null = null;
  try {
    db = await createV2PostgresDb({ pg: { connectionString } });
    await sql`select 1`.execute(db);
    return jsonResponse({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Connection failed.';
    return jsonResponse({ ok: false, error: message }, 400);
  } finally {
    if (db) {
      await db.destroy().catch(() => undefined);
    }
  }
}

export const Route = createFileRoute('/api/db/check')({
  server: {
    handlers: {
      POST: handleCheck,
    },
  },
});
