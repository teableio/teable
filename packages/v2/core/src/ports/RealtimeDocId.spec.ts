import { describe, expect, it } from 'vitest';

import { RealtimeDocId } from './RealtimeDocId';

describe('RealtimeDocId', () => {
  it('creates and parses document identifiers', () => {
    const docId = RealtimeDocId.fromParts('rec_tbl', 'rec_1')._unsafeUnwrap();

    expect(docId.toString()).toBe('rec_tbl/rec_1');
    const parsed = RealtimeDocId.parse(docId)._unsafeUnwrap();
    expect(parsed).toEqual({ collection: 'rec_tbl', docId: 'rec_1' });
  });

  it('validates input', () => {
    const invalid = RealtimeDocId.create('');
    expect(invalid.isErr()).toBe(true);
  });

  it('rejects invalid separators', () => {
    const docId = RealtimeDocId.create('rec_tbl')._unsafeUnwrap();
    const result = RealtimeDocId.parse(docId);
    expect(result.isErr()).toBe(true);
  });

  it('compares by value', () => {
    const left = RealtimeDocId.fromParts('rec', '1')._unsafeUnwrap();
    const right = RealtimeDocId.fromParts('rec', '1')._unsafeUnwrap();

    expect(left.equals(right)).toBe(true);
  });
});
