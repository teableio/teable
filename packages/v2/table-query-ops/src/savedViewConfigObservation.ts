import { type DomainError, type Table } from '@teable/v2-core';
import { err, ok, type Result } from 'neverthrow';

import { TableQueryObservationWindow } from './domain';
import { buildQueryConfigShape } from './queryConfigShape';

export type SavedViewConfigObservationInput = {
  readonly table: Table;
  readonly viewId: string;
  readonly spaceId?: string;
  readonly filter?: string | null;
  readonly sort?: string | null;
  readonly group?: string | null;
  readonly now: Date;
};

export const buildSavedViewConfigObservation = (
  input: SavedViewConfigObservationInput
): Result<TableQueryObservationWindow | undefined, DomainError> => {
  const shape = buildQueryConfigShape({
    table: input.table,
    filter: input.filter,
    sort: input.sort,
    group: input.group,
  });
  if (shape.isErr()) return err(shape.error);
  if (!shape.value) return ok(undefined);

  return TableQueryObservationWindow.create({
    spaceId: input.spaceId,
    baseId: input.table.baseId().toString(),
    tableId: input.table.id().toString(),
    windowStart: floorDate(input.now, 300_000),
    windowSizeSeconds: 300,
    shape: shape.value,
    requestCount: 1,
    slowCount: 0,
    timeoutCount: 0,
    dbErrorCount: 0,
    totalDurationMs: 0,
    maxDurationMs: 0,
    sqlDiagnostics: [
      {
        source: 'saved_view_config',
        statementKind: 'VIEW_CONFIG',
        fingerprint: `saved_view_config:${input.viewId}:${shape.value.shapeHash()}`,
        parameterCount: 0,
        sampled: false,
      },
    ],
  });
};

const floorDate = (date: Date, windowMs: number): Date =>
  new Date(Math.floor(date.getTime() / windowMs) * windowMs);
