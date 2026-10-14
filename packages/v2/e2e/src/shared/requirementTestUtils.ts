/**
 * Shared helpers for the requirement-driven e2e specs.
 *
 * These specs are written against the field capability list in
 * `staging-field-requirements.md`; the helpers keep the requirement ID visible
 * in the test title and the field lookup out of the assertion body.
 */
/* eslint-disable @typescript-eslint/naming-convention */
import type { IFieldDto, IViewDto } from '@teable/v2-contract-http';
import { expect } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './globalTestContext';

export type FieldDto = IFieldDto;

let fieldIdCounter = 0;

/** Deterministic `fld...` id so a spec can address a field before creation. */
export const nextFieldId = () => {
  const suffix = fieldIdCounter.toString(36).padStart(16, '0');
  fieldIdCounter += 1;
  return `fld${suffix}`;
};

export const fieldByName = (table: { fields: ReadonlyArray<FieldDto> }, name: string): FieldDto => {
  const field = table.fields.find((candidate) => candidate.name === name);
  if (!field) {
    throw new Error(
      `Expected field "${name}" in table, found: ${table.fields.map((f) => f.name).join(', ')}`
    );
  }
  return field;
};

/**
 * Reads a field's `options` bag without narrowing the 22-way field union.
 *
 * The contract DTOs are a discriminated union, so a spec that builds a field
 * definition from a runtime `type` variable cannot satisfy it statically. The
 * live API is the authority for those payloads, and this helper keeps the
 * assertions free of per-call casts.
 */
export const fieldOptions = (field: unknown): Record<string, unknown> =>
  ((field as { options?: unknown } | undefined)?.options as Record<string, unknown> | undefined) ??
  {};

export const firstGridId = (table: { views: ReadonlyArray<IViewDto> }): string => {
  const view = table.views[0];
  if (!view) throw new Error('Expected at least one view on the created table');
  return view.id;
};

/**
 * Reads a single row and returns the raw stored value for `fieldId`.
 *
 * Always read back through `listRecords` (which drains the computed outbox)
 * rather than the create/update response: the write responses omit system
 * field projections.
 */
export const readValue = async (
  ctx: SharedTestContext,
  tableId: string,
  recordId: string,
  fieldId: string
): Promise<unknown> => {
  const rows = await ctx.listRecords(tableId, { limit: 1000 });
  const row = rows.find((candidate) => candidate.id === recordId);
  if (!row) throw new Error(`Record ${recordId} not found while reading field ${fieldId}`);
  return row.fields[fieldId];
};

export const readAllValues = async (
  ctx: SharedTestContext,
  tableId: string,
  fieldId: string
): Promise<unknown[]> => {
  const rows = await ctx.listRecords(tableId, { limit: 1000 });
  return rows.map((row) => row.fields[fieldId]);
};

export const findRow = <T extends { id: string }>(
  rows: ReadonlyArray<T>,
  recordId: string
): T | undefined => rows.find((row) => row.id === recordId);

/** ISO instant helper for date assertions. */
export const asInstant = (value: unknown): number => {
  expect(typeof value).toBe('string');
  const parsed = Date.parse(value as string);
  expect(Number.isNaN(parsed)).toBe(false);
  return parsed;
};

export { getSharedTestContext };
export type { SharedTestContext };
