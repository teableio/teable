import {
  BaseId,
  FieldCreationSideEffectFlow,
  MemoryCommandBus,
  MemoryEventBus,
  MemoryQueryBus,
  MemoryTableRepository,
  NoopLogger,
  NoopTableSchemaRepository,
  NoopTracer,
  NoopUnitOfWork,
  TableUpdateFlow,
  v2CoreTokens,
} from '@teable/v2-core';
import type { ITableRepository } from '@teable/v2-core';
import { container } from '@teable/v2-di';

import type { IV2NodeTestContainer } from './v2NodeTestContainer';

export const createV2NodeTestContainer = async (): Promise<IV2NodeTestContainer> => {
  const c = container.createChildContainer();

  const baseIdResult = BaseId.generate();
  if (baseIdResult.isErr()) {
    throw new Error(baseIdResult.error);
  }

  const tableRepository: ITableRepository = new MemoryTableRepository();
  const eventBus = new MemoryEventBus(c);
  const commandBus = new MemoryCommandBus(c);
  const queryBus = new MemoryQueryBus(c);

  c.registerInstance(v2CoreTokens.tableRepository, tableRepository);
  c.registerInstance(v2CoreTokens.tableSchemaRepository, new NoopTableSchemaRepository());
  c.registerInstance(v2CoreTokens.eventBus, eventBus);
  c.registerInstance(v2CoreTokens.commandBus, commandBus);
  c.registerInstance(v2CoreTokens.queryBus, queryBus);
  c.registerInstance(v2CoreTokens.unitOfWork, new NoopUnitOfWork());
  c.register(v2CoreTokens.tableUpdateFlow, TableUpdateFlow);
  c.register(v2CoreTokens.fieldCreationSideEffectFlow, FieldCreationSideEffectFlow);
  c.registerInstance(v2CoreTokens.logger, new NoopLogger());
  c.registerInstance(v2CoreTokens.tracer, new NoopTracer());

  return {
    container: c,
    tableRepository,
    eventBus,
    baseId: baseIdResult.value,
    dispose: () => Promise.resolve(),
  };
};
