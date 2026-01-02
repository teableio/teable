export type SpanAttributeValue = string | number | boolean;

export type SpanAttributes = Readonly<Record<string, SpanAttributeValue>>;

/**
 * Teable-specific span attribute keys.
 * All internal attributes should be prefixed with 'teable.' for consistency.
 */
export const teableSpanAttributes = {
  // Query builder attributes
  'teable.query.mode': 'teable.query.mode',
  'teable.query.table_id': 'teable.query.table_id',
  'teable.query.table_name': 'teable.query.table_name',
  'teable.query.field_count': 'teable.query.field_count',
  'teable.query.has_filter': 'teable.query.has_filter',
  'teable.query.limit': 'teable.query.limit',
  'teable.query.offset': 'teable.query.offset',

  // Command attributes
  'teable.command.name': 'teable.command.name',
  'teable.command.base_id': 'teable.command.base_id',
  'teable.command.table_id': 'teable.command.table_id',
  'teable.command.field_id': 'teable.command.field_id',
  'teable.command.record_count': 'teable.command.record_count',

  // Query (read) attributes
  'teable.read.name': 'teable.read.name',
  'teable.read.base_id': 'teable.read.base_id',
  'teable.read.table_id': 'teable.read.table_id',

  // Repository operation attributes
  'teable.repository.operation': 'teable.repository.operation',
  'teable.repository.entity_type': 'teable.repository.entity_type',

  // Domain event attributes
  'teable.event.name': 'teable.event.name',
  'teable.event.count': 'teable.event.count',

  // Error attributes
  'teable.error.code': 'teable.error.code',
  'teable.error.category': 'teable.error.category',

  // Transaction attributes
  'teable.transaction.id': 'teable.transaction.id',
  'teable.transaction.nested': 'teable.transaction.nested',
} as const;

/** Type for teable span attribute keys */
export type TeableSpanAttributeKey =
  (typeof teableSpanAttributes)[keyof typeof teableSpanAttributes];

/** Type-safe teable span attributes record */
export type TeableSpanAttributes = Partial<Record<TeableSpanAttributeKey, SpanAttributeValue>>;

export interface ISpan {
  setAttribute(key: string, value: SpanAttributeValue): void;
  setAttributes(attributes: SpanAttributes): void;

  /**
   * Set teable-specific attributes with type safety.
   * @param attributes - Teable-specific attributes
   */
  setTeableAttributes(attributes: TeableSpanAttributes): void;

  recordError(message: string): void;
  end(): void;
}

export interface ITracer {
  /**
   * Start a new span with the given name and optional attributes.
   * @param name - The span name (recommend using 'teable.' prefix)
   * @param attributes - Optional initial attributes
   */
  startSpan(name: string, attributes?: SpanAttributes): ISpan;

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
