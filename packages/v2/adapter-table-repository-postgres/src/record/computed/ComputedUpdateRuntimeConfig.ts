export type ComputedUpdateRuntimeConfig = {
  /**
   * Transaction-local timeout for computed SQL executed inline with a user mutation.
   * Set to 0 to disable the timeout.
   */
  inlineStatementTimeoutMs: number;
};

export const defaultComputedUpdateRuntimeConfig: ComputedUpdateRuntimeConfig = {
  inlineStatementTimeoutMs: 60 * 1000,
};
