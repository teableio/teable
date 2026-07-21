import { describe, expect, it } from 'vitest';
import {
  applyFieldComputeMeta,
  isFieldCalculating,
  type FieldComputeMetaClient,
} from './apply-field-compute-meta';

type FieldStub = { id: string; computeMeta?: FieldComputeMetaClient; isPending?: boolean };

describe('applyFieldComputeMeta', () => {
  it('sets computeMeta and isPending when activity is running', () => {
    const field: FieldStub = {
      id: 'fld1',
    };
    const changed = applyFieldComputeMeta(field, {
      status: 'running',
      estimatedComplexity: 3,
    });
    expect(changed).toBe(true);
    expect(field.computeMeta?.status).toBe('running');
    expect(field.isPending).toBe(true);
  });

  it('clears isPending when status becomes idle', () => {
    const field: FieldStub = {
      id: 'fld1',
      computeMeta: { status: 'running' },
      isPending: true,
    };
    const changed = applyFieldComputeMeta(field, { status: 'idle' });
    expect(changed).toBe(true);
    expect(field.computeMeta?.status).toBe('idle');
    expect(field.isPending).toBeUndefined();
  });

  it('returns false when nothing changes', () => {
    const field: FieldStub = {
      id: 'fld1',
      computeMeta: { status: 'queued' },
      isPending: true,
    };
    const changed = applyFieldComputeMeta(field, { status: 'queued' });
    expect(changed).toBe(false);
  });
});

describe('isFieldCalculating', () => {
  it('prefers live activity override over stale field mutation', () => {
    const field = { isPending: false, computeMeta: { status: 'idle' as const } };
    // Same field object identity, but activity map says running → calculating chrome on.
    expect(isFieldCalculating(field, { status: 'running' })).toBe(true);
    // Override idle while field still has isPending true → not calculating from override status
    // (isPending still wins if true).
    expect(isFieldCalculating({ isPending: true }, { status: 'idle' })).toBe(true);
    expect(isFieldCalculating(field, { status: 'idle' })).toBe(false);
    expect(isFieldCalculating(field, { status: 'queued' })).toBe(true);
  });

  it('drives theme key change without fields array identity change', () => {
    const fields = [{ id: 'fld1', isPending: false, computeMeta: { status: 'idle' as const } }];
    const themeKey = (override?: { status?: string }) =>
      isFieldCalculating(fields[0]!, override) ? 'amber' : 'default';

    // Simulate useMemo columns with stable fields[] reference.
    const fieldsRef = fields;
    expect(themeKey(undefined)).toBe('default');
    // Activity map updates — override path must flip theme without new fields array.
    expect(fieldsRef).toBe(fields);
    expect(themeKey({ status: 'running' })).toBe('amber');
    expect(themeKey({ status: 'idle' })).toBe('default');
  });
});
