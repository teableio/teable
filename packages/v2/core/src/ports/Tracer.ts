export type SpanAttributeValue = string | number | boolean;

export type SpanAttributes = Readonly<Record<string, SpanAttributeValue>>;

export interface ISpan {
  setAttribute(key: string, value: SpanAttributeValue): void;
  setAttributes(attributes: SpanAttributes): void;
  recordError(message: string): void;
  end(): void;
}

export interface ITracer {
  startSpan(name: string, attributes?: SpanAttributes): ISpan;
}
