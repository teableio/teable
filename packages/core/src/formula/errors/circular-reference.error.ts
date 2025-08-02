/**
 * Error thrown when a circular reference is detected in formula field expansion.
 *
 * This error occurs when formula fields reference each other in a circular manner,
 * which would cause infinite recursion during SQL conversion.
 *
 * @example
 * ```
 * // Field A: {B} + 1
 * // Field B: {A} + 1
 * // This would throw a CircularReferenceError
 * ```
 */
export class CircularReferenceError extends Error {
  readonly name = 'CircularReferenceError';
  readonly fieldId: string;
  readonly expansionStack: string[];

  constructor(fieldId: string, expansionStack: string[] = []) {
    const stackTrace =
      expansionStack.length > 0
        ? ` (expansion stack: ${expansionStack.join(' → ')} → ${fieldId})`
        : '';

    super(`Circular reference detected involving field: ${fieldId}${stackTrace}`);

    this.fieldId = fieldId;
    this.expansionStack = [...expansionStack];

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, CircularReferenceError);
    }
  }

  /**
   * Returns the full circular reference chain
   */
  getCircularChain(): string[] {
    return [...this.expansionStack, this.fieldId];
  }

  /**
   * Returns a human-readable description of the circular reference
   */
  getCircularDescription(): string {
    const chain = this.getCircularChain();
    if (chain.length <= 1) {
      return `Field ${this.fieldId} references itself`;
    }
    return `Circular reference: ${chain.join(' → ')}`;
  }
}
