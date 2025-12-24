import { context as otelContext, propagation, type TextMapGetter } from '@opentelemetry/api';

const headerGetter: TextMapGetter<Headers> = {
  get: (carrier, key) => carrier.get(key) ?? undefined,
  keys: (carrier) => Array.from(carrier.keys()),
};

export const extractRequestContext = (request: Request) =>
  propagation.extract(otelContext.active(), request.headers, headerGetter);
