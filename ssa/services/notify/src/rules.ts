import { z } from 'zod';
import { extractFieldValues, valuesEqual } from './events.js';
import type { ISsaRecordEvent } from './events.js';

export const ruleSchema = z.object({
  name: z.string().min(1),
  event: z.enum(['record.created', 'record.updated', 'record.deleted']),
  tableId: z.string().optional(),
  baseId: z.string().optional(),
  /** Only fire for a specific v2 source (user | form | import | ...). */
  source: z.string().optional(),
  /** fieldId -> expected value; every entry must match one record's values. */
  matchFields: z.record(z.string(), z.unknown()).optional(),
  /** Email recipients for this rule. */
  email: z.array(z.string()).optional(),
  /** Create an in-app bell notification via POST /api/ssa/notify. */
  inApp: z
    .object({
      toUserId: z.array(z.string()).optional(),
      toEmail: z.array(z.string()).optional(),
      severity: z.enum(['info', 'warning', 'critical']).default('info'),
    })
    .optional(),
  subject: z.string().optional(),
  cooldownSeconds: z.number().int().nonnegative().default(300),
});

export type IRule = z.infer<typeof ruleSchema>;

export const rulesFileSchema = z.object({
  rules: z.array(ruleSchema).default([]),
});

/** Validates the `notify.rules.json` document; throws with a readable message. */
export const compileRules = (raw: unknown): IRule[] => {
  const parsed = rulesFileSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    throw new Error(`Invalid notify.rules.json: ${parsed.error.message}`);
  }
  return parsed.data.rules;
};

/**
 * A rule matches when the event name (and optional table/base/source filters)
 * match and — when `matchFields` is set — at least one record carries ALL the
 * expected field values (created records carry full fields; updates carry
 * new values; deletes match on event/table only).
 */
export const ruleMatches = (rule: IRule, event: ISsaRecordEvent): boolean => {
  if (rule.event !== event.event) {
    return false;
  }
  if (rule.tableId && rule.tableId !== event.tableId) {
    return false;
  }
  if (rule.baseId && rule.baseId !== event.baseId) {
    return false;
  }
  if (rule.source && rule.source !== event.source) {
    return false;
  }

  const matchFields = rule.matchFields;
  if (!matchFields || Object.keys(matchFields).length === 0) {
    return true;
  }

  const entries = extractFieldValues(event);
  if (entries.length === 0) {
    return false;
  }

  // Group by record when the event identifies records; otherwise treat the
  // whole event as one unit (v1 single-record updates have no recordId).
  const groups = new Map<string, { fieldId: string; value: unknown }[]>();
  for (const entry of entries) {
    const key = entry.recordId ?? '__event__';
    const list = groups.get(key) ?? [];
    list.push({ fieldId: entry.fieldId, value: entry.value });
    groups.set(key, list);
  }

  for (const values of groups.values()) {
    const byField = new Map(values.map((item) => [item.fieldId, item.value]));
    const allMatch = Object.entries(matchFields).every(([fieldId, expected]) =>
      byField.has(fieldId) ? valuesEqual(byField.get(fieldId), expected) : false
    );
    if (allMatch) {
      return true;
    }
  }

  return false;
};

/** Stable per-operation key used for cooldown/dedupe. */
export const ruleOperationKey = (rule: IRule, event: ISsaRecordEvent): string =>
  `${rule.name}|${event.tableId}|${[...event.recordIds].sort().join(',')}`;

/** In-memory cooldown gate; `shouldFire` records the attempt when allowed. */
export class CooldownTracker {
  private readonly lastFired = new Map<string, number>();

  shouldFire(key: string, cooldownSeconds: number, now = Date.now()): boolean {
    if (cooldownSeconds <= 0) {
      return true;
    }
    const last = this.lastFired.get(key);
    if (last != null && now - last < cooldownSeconds * 1000) {
      return false;
    }
    this.lastFired.set(key, now);
    // Opportunistic cleanup to keep the map bounded.
    if (this.lastFired.size > 1000) {
      const cutoff = now - cooldownSeconds * 1000;
      for (const [entryKey, at] of this.lastFired) {
        if (at < cutoff) {
          this.lastFired.delete(entryKey);
        }
      }
    }
    return true;
  }
}

/** Simple `{{token}}` interpolation for rule/digest subjects. */
export const renderTemplate = (
  template: string,
  values: Record<string, string | number | undefined>
): string =>
  template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) =>
    values[key] !== undefined ? String(values[key]) : ''
  );
