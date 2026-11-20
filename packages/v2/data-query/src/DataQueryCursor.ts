import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { type DomainError, type IExecutionContext, type ITableReadModel } from '@teable/v2-core';
import { err, ok, type Result } from 'neverthrow';

import type { BoundDataQueryPlan } from './BoundDataQueryPlan';
import { isPlainData, queryError } from './DataQueryDefinition';
import { dataQueryCursorSchemaContract } from './DataQuerySchemaSignature';
import type { BoundDataQuery } from './types';

export type DataQueryCursorPosition = {
  readonly values: readonly unknown[];
  readonly id: string;
};

/** Stable serialization of authorized scope state, including specification value objects. */
const canonical = (value: unknown, ancestors = new Set<object>()): unknown => {
  if (value === undefined) return null;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return { bigint: value.toString() };
  if (typeof value !== 'object') throw new Error('Unsupported cursor binding state');
  if (ancestors.has(value)) throw new Error('Cyclic cursor binding state');
  ancestors.add(value);
  const result = canonicalContainer(value, ancestors);
  ancestors.delete(value);
  return result;
};

const canonicalObject = (value: object, ancestors: Set<object>): unknown => {
  const state: Record<string, unknown> = {};
  const keys = Object.keys(value)
    .sort()
    .filter((key) => typeof (value as Record<string, unknown>)[key] !== 'function');
  for (const key of keys) {
    const child = canonical((value as Record<string, unknown>)[key], ancestors);
    if (key === '__proto__') {
      Object.defineProperty(state, key, {
        value: child,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    } else {
      state[key] = child;
    }
  }
  const prototype = Object.getPrototypeOf(value) as { constructor?: { name?: string } } | null;
  return prototype && prototype !== Object.prototype
    ? { type: prototype.constructor?.name, state }
    : state;
};

const canonicalContainer = (value: object, ancestors: Set<object>): unknown => {
  if (value instanceof Date) return { date: value.toISOString() };
  if (value instanceof Set)
    return {
      set: [...value]
        .map((entry) => canonical(entry, ancestors))
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    };
  if (value instanceof Map)
    return {
      map: [...value]
        .map(([key, entry]) => [canonical(key, ancestors), canonical(entry, ancestors)])
        .sort((a, b) => JSON.stringify(a[0]).localeCompare(JSON.stringify(b[0]))),
    };
  if (Array.isArray(value)) return value.map((entry) => canonical(entry, ancestors));
  return canonicalObject(value, ancestors);
};
const digestCanonical = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const digest = (value: unknown): string => digestCanonical(canonical(value));

/** No request/transaction identity: a continuation may execute on another server/request. */
export const createDataQueryCursorBinding = (input: {
  readonly context: Pick<IExecutionContext, 'actorId'>;
  readonly plan: BoundDataQueryPlan;
  readonly tables?: ReadonlyMap<string, ITableReadModel>;
  readonly query: BoundDataQuery;
  readonly scopes: unknown;
  readonly schemaSignature?: string;
}): Result<string, DomainError> => {
  try {
    const definition = input.query.validatedDefinition.readonlySnapshot();
    const schema = input.tables
      ? dataQueryCursorSchemaContract(input.plan, input.tables)
      : undefined;
    if (schema?.isErr()) return err(schema.error);
    const parameters = { ...input.query.expressionParameters };
    if (definition.version === 7) delete parameters[definition.page.after.name];
    const binding = {
      // Ordinary records now use the V6 native sort keys; reject older public-value positions.
      version: input.plan.resultGrain === 'record' ? 2 : 1,
      definition,
      plan: input.plan,
      parameters,
      sort: input.query.sort,
      recordId: input.query.recordId,
      schema: schema?.isOk() ? schema.value.contract : undefined,
      actorId: input.context.actorId.toString(),
      scopes: input.scopes,
      schemaSignature: input.schemaSignature,
    };
    // Keep the original traversal (including evaluation order) for non-JSON schema state.
    if (!schema?.isOk() || !schema.value.isCanonical) return ok(digest(binding));
    binding.schema = null;
    const normalized = canonical(binding) as { schema: unknown };
    normalized.schema = schema.value.contract;
    return ok(digestCanonical(normalized));
  } catch {
    return err(queryError('invalid_cursor', 'Unable to bind structured query cursor'));
  }
};

const invalidCursor = () =>
  queryError('invalid_cursor', 'Invalid or stale structured query cursor');
// The definition guard admits at most 10,000 containers, including every sort
// and DISTINCT projection. Sort values themselves remain lossless SQL text:
// JSONB scalars/objects/arrays and native numeric[] are never parsed or truncated.
const MAX_CURSOR_VALUES = 10_000;
const MAX_CURSOR_PAYLOAD_BYTES = 8 * 1024 * 1024;
const MAX_CURSOR_PAYLOAD_TEXT = Math.ceil((MAX_CURSOR_PAYLOAD_BYTES * 4) / 3);
const CURSOR_PREFIX = 'v2.';
const SIGNATURE_LENGTH = 43;
const validPosition = (value: unknown): value is DataQueryCursorPosition => {
  if (!isPlainData(value) || value === null || typeof value !== 'object' || Array.isArray(value))
    return false;
  const position = value as Record<string, unknown>;
  return (
    Object.keys(position).length === 2 &&
    Array.isArray(position.values) &&
    position.values.length <= MAX_CURSOR_VALUES &&
    position.values.every(
      (entry) => entry === null || typeof entry === 'string' || typeof entry === 'boolean'
    ) &&
    typeof position.id === 'string' &&
    position.id.length > 0 &&
    position.id.length <= 256
  );
};

const signature = (wire: string, signingKey: string): Buffer =>
  createHmac('sha256', signingKey).update(wire).digest();

/** A portable opaque continuation, not an authorization credential; execution always reauthorizes. */
export const encodeDataQueryCursor = (
  binding: unknown,
  position: DataQueryCursorPosition,
  signingKey: string
): Result<string, DomainError> => {
  try {
    if (!signingKey || !validPosition(position)) return err(invalidCursor());
    const payload = JSON.stringify({ version: 2, binding: digest(binding), position });
    if (Buffer.byteLength(payload, 'utf8') > MAX_CURSOR_PAYLOAD_BYTES) return err(invalidCursor());
    const wire = `${CURSOR_PREFIX}${Buffer.from(payload).toString('base64url')}`;
    return ok(`${wire}.${signature(wire, signingKey).toString('base64url')}`);
  } catch {
    return err(invalidCursor());
  }
};

export const decodeDataQueryCursor = (
  after: string | undefined,
  binding: unknown,
  signingKey: string
): Result<DataQueryCursorPosition | undefined, DomainError> => {
  if (after === undefined) return ok(undefined);
  try {
    if (
      !signingKey ||
      after.length > CURSOR_PREFIX.length + MAX_CURSOR_PAYLOAD_TEXT + 1 + SIGNATURE_LENGTH ||
      !after.startsWith(CURSOR_PREFIX)
    )
      return err(invalidCursor());
    const separator = after.length - SIGNATURE_LENGTH - 1;
    if (after[separator] !== '.') return err(invalidCursor());
    const payloadText = after.slice(CURSOR_PREFIX.length, separator);
    const signatureText = after.slice(separator + 1);
    if (!/^[A-Za-z0-9_-]+$/.test(payloadText) || !/^[A-Za-z0-9_-]{43}$/.test(signatureText))
      return err(invalidCursor());
    const bytes = Buffer.from(payloadText, 'base64url');
    const suppliedSignature = Buffer.from(signatureText, 'base64url');
    if (
      bytes.length > MAX_CURSOR_PAYLOAD_BYTES ||
      bytes.toString('base64url') !== payloadText ||
      suppliedSignature.toString('base64url') !== signatureText ||
      suppliedSignature.length !== 32 ||
      !timingSafeEqual(suppliedSignature, signature(after.slice(0, separator), signingKey))
    )
      return err(invalidCursor());
    // Only authenticated, bounded bytes reach the parser. Errors never echo
    // payloads, signatures, signing keys, or driver details.
    const value = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
    if (
      value === null ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).length !== 3 ||
      value.version !== 2 ||
      value.binding !== digest(binding) ||
      !validPosition(value.position)
    )
      return err(invalidCursor());
    return ok(value.position);
  } catch {
    return err(invalidCursor());
  }
};
