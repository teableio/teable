import { describe, expect, it } from 'vitest';
import type { ISsaRecordEvent } from './events.js';
import {
  CooldownTracker,
  compileRules,
  renderTemplate,
  ruleMatches,
  ruleOperationKey,
} from './rules.js';

const event = (overrides: Partial<ISsaRecordEvent> = {}): ISsaRecordEvent => ({
  version: 1,
  event: 'record.created',
  tableId: 'tbl1',
  baseId: 'bse1',
  recordIds: ['rec1'],
  recordCount: 1,
  isBulk: false,
  truncated: false,
  timestamp: 'T',
  records: [{ id: 'rec1', fields: { fldStatus: 'Urgent', fldOwner: 'ops' } }],
  ...overrides,
});

describe('compileRules', () => {
  it('applies defaults and validates the document', () => {
    const rules = compileRules({
      rules: [{ name: 'urgent', event: 'record.created', email: ['x@example.com'] }],
    });
    expect(rules[0].cooldownSeconds).toBe(300);

    expect(() => compileRules({ rules: [{ name: '', event: 'nope' }] })).toThrow(
      /Invalid notify.rules.json/
    );
  });
});

describe('ruleMatches', () => {
  const rule = compileRules({
    rules: [
      {
        name: 'urgent',
        event: 'record.created',
        tableId: 'tbl1',
        matchFields: { fldStatus: 'Urgent' },
        email: ['x@example.com'],
      },
    ],
  })[0];

  it('matches when the event and every field condition match', () => {
    expect(ruleMatches(rule, event())).toBe(true);
  });

  it('does not match on other events, tables or values', () => {
    expect(ruleMatches(rule, event({ event: 'record.updated' }))).toBe(false);
    expect(ruleMatches(rule, event({ tableId: 'tbl2' }))).toBe(false);
    expect(
      ruleMatches(rule, event({ records: [{ id: 'rec1', fields: { fldStatus: 'Low' } }] }))
    ).toBe(false);
  });

  it('matches update events through the new value', () => {
    const updateRule = compileRules({
      rules: [
        {
          name: 'done',
          event: 'record.updated',
          matchFields: { fldStatus: 'Done' },
          email: ['x@example.com'],
        },
      ],
    })[0];

    expect(
      ruleMatches(
        updateRule,
        event({
          event: 'record.updated',
          changes: {
            fieldIds: ['fldStatus'],
            cellContexts: [{ fieldId: 'fldStatus', oldValue: 'Todo', newValue: 'Done' }],
          },
        })
      )
    ).toBe(true);
  });

  it('respects the source filter', () => {
    const sourced = compileRules({
      rules: [
        {
          name: 'forms',
          event: 'record.created',
          source: 'form',
          email: ['x@example.com'],
        },
      ],
    })[0];

    expect(ruleMatches(sourced, event({ source: 'user' }))).toBe(false);
    expect(ruleMatches(sourced, event({ source: 'form' }))).toBe(true);
  });
});

describe('CooldownTracker', () => {
  it('suppresses repeats inside the window and allows them after', () => {
    const tracker = new CooldownTracker();
    expect(tracker.shouldFire('k', 10, 1_000)).toBe(true);
    expect(tracker.shouldFire('k', 10, 5_000)).toBe(false);
    expect(tracker.shouldFire('k', 10, 12_000)).toBe(true);
    expect(tracker.shouldFire('other', 10, 12_001)).toBe(true);
  });

  it('treats zero cooldown as always-fire', () => {
    const tracker = new CooldownTracker();
    expect(tracker.shouldFire('k', 0, 1)).toBe(true);
    expect(tracker.shouldFire('k', 0, 1)).toBe(true);
  });
});

describe('ruleOperationKey', () => {
  it('is stable regardless of record order', () => {
    const rule = compileRules({ rules: [{ name: 'r', event: 'record.created' }] })[0];
    const a = ruleOperationKey(rule, event({ recordIds: ['a', 'b'] }));
    const b = ruleOperationKey(rule, event({ recordIds: ['b', 'a'] }));
    expect(a).toBe(b);
  });
});

describe('renderTemplate', () => {
  it('interpolates known tokens and drops unknown ones', () => {
    expect(
      renderTemplate('Hi {{name}} on {{date}} — {{missing}}', { name: 'SSA', date: 'Mon' })
    ).toBe('Hi SSA on Mon — ');
  });
});
