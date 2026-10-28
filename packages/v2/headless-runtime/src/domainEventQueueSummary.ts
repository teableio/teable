import { sql, type Kysely } from 'kysely';

export interface IDomainEventQueueSummary {
  durablePending: number;
  scheduled: number;
  processing: number;
  deadLetter: number;
  nextRunAt: string | null;
}

type CountRow = { count: number | string | bigint | null };
type NextRunRow = { nextRunAt: Date | string | null };

const toCount = (value: CountRow['count']): number => Number(value ?? 0);

const isMissingRelationError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === '42P01';

const tableRef = (schema: string | undefined, name: string) =>
  schema ? sql`${sql.id(schema)}.${sql.id(name)}` : sql.table(name);
/**
 * Read-only delivery status for the durable domain-event journal. It covers
 * events not yet expanded plus delivery rows, so a host can distinguish an
 * empty queue from durable work whose worker is unavailable.
 */
export const readDomainEventQueueSummary = async (
  db: Kysely<unknown>,
  now = new Date(),
  schema?: string
): Promise<IDomainEventQueueSummary> => {
  const outbox = tableRef(schema, 'domain_event_outbox');
  const delivery = tableRef(schema, 'domain_event_delivery');
  try {
    const counts = await sql<{
      unpublished: CountRow['count'];
      pending: CountRow['count'];
      scheduled: CountRow['count'];
      processing: CountRow['count'];
      deadLetter: CountRow['count'];
    }>`
      select
        (select count(*) from ${outbox} where unpublished) as unpublished,
        (select count(*) from ${delivery} where status = 'pending') as pending,
        (
          select count(*) from ${delivery}
          where status = 'pending' and next_attempt_at > ${now}
        ) as scheduled,
        (select count(*) from ${delivery} where status = 'processing') as processing,
        (select count(*) from ${delivery} where status = 'dead') as "deadLetter"
    `.execute(db);
    const next = await sql<NextRunRow>`
      select min(next_attempt_at) as "nextRunAt"
      from ${delivery}
      where status = 'pending'
    `.execute(db);
    const row = counts.rows[0];
    const pending = toCount(row?.pending);
    const scheduled = toCount(row?.scheduled);
    const nextRunAt = next.rows[0]?.nextRunAt;
    return {
      durablePending: toCount(row?.unpublished) + pending + toCount(row?.processing),
      scheduled,
      processing: toCount(row?.processing),
      deadLetter: toCount(row?.deadLetter),
      nextRunAt:
        nextRunAt instanceof Date
          ? nextRunAt.toISOString()
          : typeof nextRunAt === 'string'
            ? nextRunAt
            : null,
    };
  } catch (error) {
    if (isMissingRelationError(error) && !schema) {
      return { durablePending: 0, scheduled: 0, processing: 0, deadLetter: 0, nextRunAt: null };
    }
    throw error;
  }
};
