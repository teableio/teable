import { describe, it, expect } from 'vitest';
import { CircularReferenceError } from './circular-reference.error';

describe('CircularReferenceError', () => {
  it('should create error with field ID only', () => {
    const error = new CircularReferenceError('field1');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('CircularReferenceError');
    expect(error.fieldId).toBe('field1');
    expect(error.expansionStack).toEqual([]);
    expect(error.message).toBe('Circular reference detected involving field: field1');
  });

  it('should create error with expansion stack', () => {
    const expansionStack = ['field2', 'field3'];
    const error = new CircularReferenceError('field1', expansionStack);

    expect(error.fieldId).toBe('field1');
    expect(error.expansionStack).toEqual(['field2', 'field3']);
    expect(error.message).toBe(
      'Circular reference detected involving field: field1 (expansion stack: field2 → field3 → field1)'
    );
  });

  it('should return circular chain correctly', () => {
    const error = new CircularReferenceError('field1', ['field2', 'field3']);

    expect(error.getCircularChain()).toEqual(['field2', 'field3', 'field1']);
  });

  it('should return circular chain for single field', () => {
    const error = new CircularReferenceError('field1');

    expect(error.getCircularChain()).toEqual(['field1']);
  });

  it('should return circular description for self-reference', () => {
    const error = new CircularReferenceError('field1');

    expect(error.getCircularDescription()).toBe('Field field1 references itself');
  });

  it('should return circular description for multi-field reference', () => {
    const error = new CircularReferenceError('field1', ['field2', 'field3']);

    expect(error.getCircularDescription()).toBe('Circular reference: field2 → field3 → field1');
  });

  it('should not mutate original expansion stack', () => {
    const originalStack = ['field2', 'field3'];
    const error = new CircularReferenceError('field1', originalStack);

    // Modify the error's stack
    error.expansionStack.push('field4');

    // Original should be unchanged
    expect(originalStack).toEqual(['field2', 'field3']);
    expect(error.expansionStack).toEqual(['field2', 'field3', 'field4']);
  });

  it('should handle empty expansion stack in description', () => {
    const error = new CircularReferenceError('field1', []);

    expect(error.getCircularDescription()).toBe('Field field1 references itself');
  });

  it('should handle complex circular chain', () => {
    const error = new CircularReferenceError('fieldA', ['fieldB', 'fieldC', 'fieldD']);

    expect(error.getCircularChain()).toEqual(['fieldB', 'fieldC', 'fieldD', 'fieldA']);
    expect(error.getCircularDescription()).toBe(
      'Circular reference: fieldB → fieldC → fieldD → fieldA'
    );
  });
});
