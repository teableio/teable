export type SpanAttributeValue = string | number | boolean;

export type SpanAttributes = Readonly<Record<string, SpanAttributeValue>>;

export interface ISpan {
  setAttribute(key: string, value: SpanAttributeValue): void;
  setAttributes(attributes: SpanAttributes): void;
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
