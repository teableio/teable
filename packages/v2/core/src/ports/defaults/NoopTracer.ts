/* eslint-disable @typescript-eslint/no-empty-function */
import type { ISpan, ITracer, SpanAttributeValue, SpanAttributes } from '../Tracer';

const noopSpan: ISpan = {
  setAttribute(_key: string, _value: SpanAttributeValue) {},
  setAttributes(_attributes: SpanAttributes) {},
  recordError(_message: string) {},
  end() {},
};

export class NoopTracer implements ITracer {
  startSpan(_name: string, _attributes?: SpanAttributes): ISpan {
    return noopSpan;
  }

  async withSpan<T>(_span: ISpan, callback: () => Promise<T>): Promise<T> {
    return callback();
  }

  getActiveSpan(): ISpan | undefined {
    return undefined;
  }
}
