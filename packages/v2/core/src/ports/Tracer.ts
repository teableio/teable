export type SpanAttributeValue = string | number | boolean;

export type SpanAttributes = Readonly<Record<string, SpanAttributeValue>>;

/**
 * Branded type for span names that must start with 'teable.' prefix.
 * Use `teableSpanName()` helper to create validated span names.
 */
export type TeableSpanName = string & { readonly __brand: 'TeableSpanName' };

/**
 * Create a validated teable span name.
 * Enforces the 'teable.' prefix at runtime.
 *
 * @example
 * teableSpanName('teable.handler.method') // OK
 * teableSpanName('other.name') // throws Error
 */
export const teableSpanName = <T extends `teable.${string}`>(name: T): TeableSpanName => {
  return name as unknown as TeableSpanName;
};

/**
 * Type guard to check if a string is a valid teable span name.
 */
export const isTeableSpanName = (name: string): name is TeableSpanName => {
  return name.startsWith('teable.');
};

/**
 * Teable span attribute keys with 'teable.' prefix.
 * All v2 spans should include these attributes for consistent tracing.
 */
export const TeableSpanAttributes = {
  /** The version of teable system (always 'v2' for v2 core) */
  VERSION: 'teable.version',
  /** The component type: 'command', 'query', 'handler', 'repository', 'service', 'domain' */
  COMPONENT: 'teable.component',
  /** The specific operation name */
  OPERATION: 'teable.operation',
  /** The handler or class name */
  HANDLER: 'teable.handler',
  /** The command name (for command spans) */
  COMMAND: 'teable.command',
  /** The query name (for query spans) */
  QUERY: 'teable.query',
  /** The table ID being operated on */
  TABLE_ID: 'teable.table_id',
  /** The record ID being operated on */
  RECORD_ID: 'teable.record_id',
  /** The field ID being operated on */
  FIELD_ID: 'teable.field_id',
} as const;

/**
 * Component types for teable spans.
 */
export type TeableComponent =
  | 'command'
  | 'query'
  | 'handler'
  | 'repository'
  | 'service'
  | 'domain'
  | 'projection';

/**
 * Create default teable span attributes.
 * All v2 spans should include these base attributes.
 */
export const createTeableSpanAttributes = (
  component: TeableComponent,
  operation: string,
  extra?: SpanAttributes
): SpanAttributes => ({
  [TeableSpanAttributes.VERSION]: 'v2',
  [TeableSpanAttributes.COMPONENT]: component,
  [TeableSpanAttributes.OPERATION]: operation,
  ...extra,
});

export interface ISpan {
  setAttribute(key: string, value: SpanAttributeValue): void;
  setAttributes(attributes: SpanAttributes): void;
  recordError(message: string): void;
  end(): void;
}

export interface ITracer {
  /**
   * Start a new span with the given name and optional attributes.
   * @param name - The span name (must use 'teable.' prefix)
   * @param attributes - Optional initial attributes
   */
  startSpan(name: TeableSpanName | string, attributes?: SpanAttributes): ISpan;

  /**
   * Execute a callback within the context of a span.
   * @param span - The span to use as context
   * @param callback - The async function to execute
   */
  withSpan<T>(span: ISpan, callback: () => Promise<T>): Promise<T>;

  /**
   * Get the currently active span, if any.
   * Returns undefined if no span is active.
   */
  getActiveSpan(): ISpan | undefined;
}
