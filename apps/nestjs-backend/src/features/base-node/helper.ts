import { getBaseNodeChannel } from '@teable/core';
import type {
  IBaseNodePresenceFlushPayload,
  IBaseNodePresenceCreatePayload,
  IBaseNodePresenceUpdatePayload,
  IBaseNodePresenceDeletePayload,
} from '@teable/openapi';
import type { Knex } from 'knex';
import { snakeCase } from 'lodash';
import type { LocalPresence } from 'sharedb/lib/client';
import type { ShareDbService } from '../../share-db/share-db.service';

export const buildBatchUpdateSql = (
  knex: Knex,
  data: { id: string; values: { [key: string]: unknown } }[]
): string | null => {
  if (data.length === 0) {
    return null;
  }

  const caseStatements: Record<string, { when: string; then: unknown }[]> = {};
  for (const { id, values } of data) {
    for (const [key, value] of Object.entries(values)) {
      if (!caseStatements[key]) {
        caseStatements[key] = [];
      }
      caseStatements[key].push({ when: id, then: value });
    }
  }

  const updatePayload: Record<string, Knex.Raw> = {};
  for (const [key, statements] of Object.entries(caseStatements)) {
    if (statements.length === 0) {
      continue;
    }
    const column = snakeCase(key);
    const whenClauses: string[] = [];
    const caseBindings: unknown[] = [];
    for (const { when, then } of statements) {
      whenClauses.push('WHEN ?? = ? THEN ?');
      caseBindings.push('id', when, then);
    }
    const caseExpression = `CASE ${whenClauses.join(' ')} ELSE ?? END`;
    const rawExpression = knex.raw(caseExpression, [...caseBindings, column]);
    updatePayload[column] = rawExpression;
  }

  if (Object.keys(updatePayload).length === 0) {
    return null;
  }

  const idsToUpdate = data.map((item) => item.id);
  return knex('base_node').update(updatePayload).whereIn('id', idsToUpdate).toQuery();
};

export const presenceHandler = <
  T =
    | IBaseNodePresenceFlushPayload
    | IBaseNodePresenceCreatePayload
    | IBaseNodePresenceUpdatePayload
    | IBaseNodePresenceDeletePayload,
>(
  baseId: string,
  shareDbService: ShareDbService,
  handler: (presence: LocalPresence<T>) => void
) => {
  const channel = getBaseNodeChannel(baseId);
  const presence = shareDbService.connect().getPresence(channel);
  const localPresence = presence.create(channel);
  handler(localPresence);
  localPresence.destroy();
};
