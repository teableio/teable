import {
  NoopEventPublisher,
  NoopTableRepository,
  NoopTableSchemaRepository,
  NoopUnitOfWork,
  v2CoreTokens,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { Lifecycle, container } from '@teable/v2-di';

export const registerV2BrowserNoopDependencies = (
  c: DependencyContainer = container
): DependencyContainer => {
  c.register(v2CoreTokens.tableRepository, NoopTableRepository, {
    lifecycle: Lifecycle.Singleton,
  });
  c.register(v2CoreTokens.tableSchemaRepository, NoopTableSchemaRepository, {
    lifecycle: Lifecycle.Singleton,
  });
  c.register(v2CoreTokens.eventPublisher, NoopEventPublisher, {
    lifecycle: Lifecycle.Singleton,
  });
  c.register(v2CoreTokens.unitOfWork, NoopUnitOfWork, {
    lifecycle: Lifecycle.Singleton,
  });
  return c;
};

export const createV2BrowserContainer = (): DependencyContainer => {
  const c = container.createChildContainer();
  return registerV2BrowserNoopDependencies(c);
};
