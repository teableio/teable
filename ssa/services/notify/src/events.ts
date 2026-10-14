import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Canonical record event forwarded by the Teable backend
 * (`apps/nestjs-backend/src/features/ssa/ssa-event-forwarder.ts`).
 * See docs/ssa/ARCHITECTURE.md for the contract.
 */
export interface ISsaSampleRecord {
  id: string;
  fields: Record<string, unknown>;
}

export interface ISsaRecordEvent {
  version: number;
  event: 'record.created' | 'record.updated' | 'record.deleted' | string;
  tableId: string;
  baseId?: string;
  recordIds: string[];
  recordCount: number;
  isBulk: boolean;
  truncated: boolean;
  user?: { id: string; name?: string; email?: string };
  timestamp: string;
  records?: ISsaSampleRecord[];
  changes?: { fieldIds: string[]; cellContexts?: unknown[] };
  source?: string;
}

/** Constant-time comparison of the `sha256=<hex>` signature header. */
export const verifySignature = (secret: string, rawBody: string, header: string): boolean => {
  if (!secret || !header) {
    return false;
  }
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const received = Buffer.from(header);
  const wanted = Buffer.from(expected);
  if (received.length !== wanted.length) {
    return false;
  }
  return timingSafeEqual(received, wanted);
};

export const isRecordEvent = (value: unknown): value is ISsaRecordEvent => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const event = value as Partial<ISsaRecordEvent>;
  return (
    typeof event.event === 'string' &&
    typeof event.tableId === 'string' &&
    Array.isArray(event.recordIds)
  );
};

/** Extract (fieldId, value) pairs carried by an event, per record when known. */
export const extractFieldValues = (
  event: ISsaRecordEvent
): { recordId?: string; fieldId: string; value: unknown }[] => {
  if (event.event === 'record.created' || event.event === 'record.deleted') {
    return (event.records ?? []).flatMap((record) =>
      Object.entries(record.fields ?? {}).map(([fieldId, value]) => ({
        recordId: record.id,
        fieldId,
        value,
      }))
    );
  }

  const contexts = (event.changes?.cellContexts ?? []) as {
    recordId?: string;
    fieldId?: string;
    newValue?: unknown;
  }[];
  return contexts
    .filter((context) => typeof context?.fieldId === 'string')
    .map((context) => ({
      recordId: context.recordId,
      fieldId: context.fieldId as string,
      value: context.newValue,
    }));
};

/** Loose equality used by rule matching (deep for arrays/objects). */
export const valuesEqual = (left: unknown, right: unknown): boolean => {
  if (left === right) {
    return true;
  }
  if (left == null || right == null) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return JSON.stringify(left) === JSON.stringify(right);
  }
  if (typeof left === 'object' || typeof right === 'object') {
    return JSON.stringify(left) === JSON.stringify(right);
  }
  return String(left) === String(right);
};
