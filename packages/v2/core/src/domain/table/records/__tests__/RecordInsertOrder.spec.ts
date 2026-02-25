import { describe, expect, it } from 'vitest';

import { RecordInsertOrder } from '../RecordInsertOrder';

describe('RecordInsertOrder', () => {
  it('creates valid order with before position', () => {
    const result = RecordInsertOrder.create({
      viewId: `viw${'a'.repeat(16)}`,
      anchorId: `rec${'b'.repeat(16)}`,
      position: 'before',
    });
    const order = result._unsafeUnwrap();

    expect(order.position).toBe('before');
    expect(order.viewId.toString()).toBe(`viw${'a'.repeat(16)}`);
    expect(order.anchorId.toString()).toBe(`rec${'b'.repeat(16)}`);
  });

  it('creates valid order with after position', () => {
    const result = RecordInsertOrder.create({
      viewId: `viw${'c'.repeat(16)}`,
      anchorId: `rec${'d'.repeat(16)}`,
      position: 'after',
    });
    result._unsafeUnwrap();
  });

  it('rejects invalid position', () => {
    const result = RecordInsertOrder.create({
      viewId: `viw${'a'.repeat(16)}`,
      anchorId: `rec${'b'.repeat(16)}`,
      position: 'middle',
    });
    result._unsafeUnwrapErr();
  });

  it('rejects missing fields', () => {
    const result = RecordInsertOrder.create({
      viewId: `viw${'a'.repeat(16)}`,
    });
    result._unsafeUnwrapErr();
  });

  it('rejects empty input', () => {
    const result = RecordInsertOrder.create({});
    result._unsafeUnwrapErr();
  });

  it('equality check works for same values', () => {
    const order1 = RecordInsertOrder.create({
      viewId: `viw${'e'.repeat(16)}`,
      anchorId: `rec${'f'.repeat(16)}`,
      position: 'before',
    })._unsafeUnwrap();

    const order2 = RecordInsertOrder.create({
      viewId: `viw${'e'.repeat(16)}`,
      anchorId: `rec${'f'.repeat(16)}`,
      position: 'before',
    })._unsafeUnwrap();

    expect(order1.equals(order2)).toBe(true);
  });

  it('equality check returns false for different values', () => {
    const order1 = RecordInsertOrder.create({
      viewId: `viw${'e'.repeat(16)}`,
      anchorId: `rec${'f'.repeat(16)}`,
      position: 'before',
    })._unsafeUnwrap();

    const order2 = RecordInsertOrder.create({
      viewId: `viw${'e'.repeat(16)}`,
      anchorId: `rec${'f'.repeat(16)}`,
      position: 'after',
    })._unsafeUnwrap();

    expect(order1.equals(order2)).toBe(false);
  });
});
