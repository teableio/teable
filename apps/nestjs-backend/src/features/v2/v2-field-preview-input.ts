import type { Table, IExecutionContext } from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';

// Request-local, in-process source evidence. It is never serialized or accepted from clients.
const sources = new WeakMap<object, Table>();

export const captureFieldPreviewSource = (input: object, table: Table): void => {
  sources.set(input, table);
};

export const fieldPreviewSource = (input: unknown): Table | undefined =>
  typeof input === 'object' && input !== null ? sources.get(input) : undefined;

type FieldPreviewRoute = {
  readonly container: DependencyContainer;
  readonly context: IExecutionContext;
};
const routes = new WeakMap<object, FieldPreviewRoute>();

export const captureFieldPreviewRoute = (input: object, route: FieldPreviewRoute): void => {
  routes.set(input, route);
};

export const fieldPreviewRoute = (input: unknown): FieldPreviewRoute | undefined =>
  typeof input === 'object' && input !== null ? routes.get(input) : undefined;
