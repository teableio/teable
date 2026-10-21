import { defaultFormulaSourceBudgetLimits } from '@teable/formula';
import { domainError, tableDataSafetyLimitErrors, type DomainError } from '@teable/v2-core';
import { err, ok, type Result } from 'neverthrow';

/** Ordinary helper callers do not create a compilation; their text builder is stateless. */
export const sqlText = (parts: TemplateStringsArray, ...values: ReadonlyArray<unknown>): string => {
  let result = parts[0];
  for (let index = 0; index < values.length; index++)
    result += String(values[index]) + parts[index + 1];
  return result;
};
export const joinSqlText = (
  values: ReadonlyArray<string>,
  separator: string,
  budget?: FormulaCompileBudget
): string => (budget ? budget.join(values, separator) : values.join(separator));

type GraphKeyValue = string | number | boolean | null | undefined | ReadonlyArray<GraphKeyValue>;
export type FormulaBudgetMetric =
  | 'visitedNodes'
  | 'uniqueNodes'
  | 'astDepth'
  | 'referenceDepth'
  | 'bindings'
  | 'fragmentBytes'
  | 'sqlBytes';
export type FormulaBudgetViolation = {
  metric: FormulaBudgetMetric;
  attempted: number;
  max: number;
};
export interface FormulaCompileBudgetPolicy {
  check(metric: FormulaBudgetMetric, attempted: number): FormulaBudgetViolation | undefined;
}
export type FormulaCompileBudgetOptions = {
  policy: FormulaCompileBudgetPolicy;
  mode: 'observe' | 'enforce';
  policyVersion: number;
  onViolation?: (violation: FormulaBudgetViolation) => void;
};

export const assertFormulaCompileBudgetOptions = (options: FormulaCompileBudgetOptions): void => {
  if (
    !Number.isSafeInteger(options.policyVersion) ||
    options.policyVersion < 1 ||
    (options.mode !== 'observe' && options.mode !== 'enforce') ||
    typeof options.policy?.check !== 'function'
  ) {
    throw new Error('Invalid formula compile budget configuration');
  }
};

/** Provisional version-one thresholds, not production-validated release limits. */
export const defaultFormulaCompileBudgetLimits: Readonly<Record<FormulaBudgetMetric, number>> =
  Object.freeze({
    ...defaultFormulaSourceBudgetLimits,
    uniqueNodes: 8192,
    bindings: 1024,
    fragmentBytes: 4194304,
    sqlBytes: 262144,
  });
export const createFormulaCompileBudgetPolicy = (
  limits: Readonly<Record<FormulaBudgetMetric, number>>
): FormulaCompileBudgetPolicy => {
  const snapshot = { ...limits };
  for (const metric of Object.keys(defaultFormulaCompileBudgetLimits) as FormulaBudgetMetric[]) {
    if (!Number.isSafeInteger(snapshot[metric]) || snapshot[metric] < 0) {
      throw new Error(`Invalid formula compile budget: ${metric}`);
    }
  }
  return Object.freeze({
    check: (metric: FormulaBudgetMetric, attempted: number) =>
      attempted > snapshot[metric] ? { metric, attempted, max: snapshot[metric] } : undefined,
  });
};
export const defaultFormulaCompileBudgetPolicy = createFormulaCompileBudgetPolicy(
  defaultFormulaCompileBudgetLimits
);
const defaultOptions: FormulaCompileBudgetOptions = {
  policy: defaultFormulaCompileBudgetPolicy,
  mode: 'observe',
  policyVersion: 1,
};
const errors = {
  visitedNodes: tableDataSafetyLimitErrors.formulaCompileNodesMax,
  uniqueNodes: tableDataSafetyLimitErrors.formulaCompileNodesMax,
  astDepth: tableDataSafetyLimitErrors.formulaCompileDepthMax,
  referenceDepth: tableDataSafetyLimitErrors.formulaReferenceDepthMax,
  bindings: tableDataSafetyLimitErrors.formulaBindingsMax,
  fragmentBytes: tableDataSafetyLimitErrors.formulaCompileBytesMax,
  sqlBytes: tableDataSafetyLimitErrors.formulaSqlBytesMax,
} as const;
export const isFormulaCompileBudgetError = (error: DomainError): boolean => {
  for (const metric in errors)
    if (errors[metric as FormulaBudgetMetric].code === error.code) return true;
  return false;
};

export class FormulaCompileBudgetViolationError extends Error {
  constructor(
    readonly violation: FormulaBudgetViolation,
    readonly policyVersion: number
  ) {
    super(`Formula compilation exceeds ${violation.metric} budget`);
    this.name = 'FormulaCompileBudgetViolationError';
  }
  toDomainError(): DomainError {
    const limit = errors[this.violation.metric];
    return domainError.validation({
      code: limit.code,
      message: this.message,
      details: {
        metric: this.violation.metric,
        attempted: this.violation.attempted,
        max: this.violation.max,
        policyVersion: this.policyVersion,
      },
      localization: { i18nKey: limit.i18nKey, context: { max: this.violation.max } },
    });
  }
}

/** State is compilation-local; cached UTF-8 sizes avoid rescanning shared SQL fragments. */
export class FormulaCompileBudget {
  private readonly reported = new Set<FormulaBudgetMetric>();
  private readonly sizes = new Map<string, number>();
  private fragments = 0;
  private visited = 0;
  private readonly metrics: Record<FormulaBudgetMetric, number> = {
    visitedNodes: 0,
    uniqueNodes: 0,
    astDepth: 0,
    referenceDepth: 0,
    bindings: 0,
    fragmentBytes: 0,
    sqlBytes: 0,
  };
  snapshot(): Readonly<Record<FormulaBudgetMetric, number>> {
    return { ...this.metrics };
  }
  readonly options: FormulaCompileBudgetOptions;
  constructor(options: FormulaCompileBudgetOptions = defaultOptions) {
    assertFormulaCompileBudgetOptions(options);
    this.options = Object.freeze({ ...options });
  }
  check(metric: FormulaBudgetMetric, attempted: number): void {
    this.metrics[metric] = Math.max(this.metrics[metric], attempted);
    const violation = this.options.policy.check(metric, attempted);
    if (!violation) return;
    if (!this.reported.has(metric)) {
      this.reported.add(metric);
      this.options.onViolation?.(violation);
    }
    if (this.options.mode === 'enforce')
      throw new FormulaCompileBudgetViolationError(violation, this.options.policyVersion);
  }
  inspectTree(
    inspect: (check: (metric: 'astDepth' | 'visitedNodes', attempted: number) => void) => void,
    charge: boolean
  ): void {
    let nodes = 0;
    inspect((metric, attempted) => {
      if (metric === 'visitedNodes') {
        nodes = Math.max(nodes, attempted);
        this.check(metric, this.visited + attempted);
      } else this.check(metric, attempted);
    });
    if (charge) this.visited += nodes;
  }
  bytes(value: string): number {
    const cached = this.sizes.get(value);
    if (cached !== undefined) return cached;
    const size = Buffer.byteLength(value, 'utf8');
    this.sizes.set(value, size);
    return size;
  }
  allocate(bytes: number): void {
    this.check('fragmentBytes', this.fragments + bytes);
    this.fragments += bytes;
  }
  readonly sql = (parts: TemplateStringsArray, ...values: ReadonlyArray<unknown>): string => {
    let bytes = 0;
    let previous = -1;
    for (let index = 0; index < parts.length + values.length; index++) {
      const part = index % 2 === 0 ? parts[index / 2] : String(values[(index - 1) / 2]);
      if (!part.length) continue;
      const first = part.charCodeAt(0); // NOSONAR typescript:S7758 -- the budget works in UTF-16 code units: it pairs surrogate halves across parts and counts JSON escapes for lone ones, which code points would merge away
      bytes += this.bytes(part);
      if (previous >= 0xd800 && previous <= 0xdbff && first >= 0xdc00 && first <= 0xdfff)
        bytes -= 2;
      previous = part.charCodeAt(part.length - 1); // NOSONAR typescript:S7758 -- the budget works in UTF-16 code units: it pairs surrogate halves across parts and counts JSON escapes for lone ones, which code points would merge away
    }
    this.allocate(bytes);
    let result = parts[0];
    for (let i = 0; i < values.length; i++) result += String(values[i]) + parts[i + 1];
    this.sizes.set(result, bytes);
    return result;
  };
  join(values: ReadonlyArray<string>, separator: string): string {
    let bytes = 0;
    let previous = -1;
    for (let index = 0; index < values.length * 2 - 1; index++) {
      const part = index % 2 === 0 ? values[index / 2] : separator;
      if (!part.length) continue;
      const first = part.charCodeAt(0); // NOSONAR typescript:S7758 -- the budget works in UTF-16 code units: it pairs surrogate halves across parts and counts JSON escapes for lone ones, which code points would merge away
      bytes += this.bytes(part);
      if (previous >= 0xd800 && previous <= 0xdbff && first >= 0xdc00 && first <= 0xdfff)
        bytes -= 2;
      previous = part.charCodeAt(part.length - 1); // NOSONAR typescript:S7758 -- the budget works in UTF-16 code units: it pairs surrogate halves across parts and counts JSON escapes for lone ones, which code points would merge away
    }
    this.allocate(bytes);
    const result = values.join(separator);
    this.sizes.set(result, bytes);
    return result;
  }
  json(values: ReadonlyArray<GraphKeyValue>): string {
    let bytes = 0;
    const pending: GraphKeyValue[] = [values];
    while (pending.length) {
      const value = pending.pop();
      if (typeof value === 'string') {
        bytes += this.jsonStringBytes(value);
      } else if (Array.isArray(value)) {
        bytes += 2 + Math.max(0, value.length - 1);
        for (const item of value) pending.push(item);
      } else if (typeof value === 'number' && Number.isFinite(value)) bytes += String(value).length;
      else if (value === true) bytes += 4;
      else if (value === false) bytes += 5;
      else bytes += 4;
    }
    this.allocate(bytes);
    const result = JSON.stringify(values);
    this.sizes.set(result, bytes);
    return result;
  }
  private jsonStringBytes(value: string): number {
    let bytes = this.bytes(value) + 2;
    for (let index = 0; index < value.length; index++) {
      const code = value.charCodeAt(index); // NOSONAR typescript:S7758 -- the budget works in UTF-16 code units: it pairs surrogate halves across parts and counts JSON escapes for lone ones, which code points would merge away
      if (code === 34 || code === 92) bytes++;
      else if (code < 32)
        bytes += code === 8 || code === 9 || code === 10 || code === 12 || code === 13 ? 1 : 5;
      else if (code >= 0xd800 && code <= 0xdfff)
        bytes += this.jsonSurrogateEscapeBytes(value, index, code);
    }
    return bytes;
  }
  private jsonSurrogateEscapeBytes(value: string, index: number, code: number): number {
    if (code < 0xdc00) {
      const next = value.charCodeAt(index + 1); // NOSONAR typescript:S7758 -- the budget works in UTF-16 code units: it pairs surrogate halves across parts and counts JSON escapes for lone ones, which code points would merge away
      return next >= 0xdc00 && next <= 0xdfff ? 0 : 3;
    }
    const previous = value.charCodeAt(index - 1); // NOSONAR typescript:S7758 -- the budget works in UTF-16 code units: it pairs surrogate halves across parts and counts JSON escapes for lone ones, which code points would merge away
    return previous >= 0xd800 && previous <= 0xdbff ? 0 : 3;
  }
  boundary<T>(operation: () => T): Result<T, DomainError> {
    try {
      return ok(operation());
    } catch (error) {
      if (error instanceof FormulaCompileBudgetViolationError) return err(error.toDomainError());
      throw error;
    }
  }
}

/** Check the complete host statement, including casts, CTEs and UPDATE wrappers. */
export const checkFormulaSqlBudget = (
  sql: string,
  options?: FormulaCompileBudgetOptions
): Result<string, DomainError> => {
  const budget = new FormulaCompileBudget(options);
  return budget.boundary(() => {
    budget.check('sqlBytes', budget.bytes(sql));
    return sql;
  });
};
