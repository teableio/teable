export const v2CoreTokens = {
  tableRepository: Symbol('v2.core.tableRepository'),
  tableSchemaRepository: Symbol('v2.core.tableSchemaRepository'),
  tableUpdateFlow: Symbol('v2.core.tableUpdateFlow'),
  fieldCreationSideEffectService: Symbol('v2.core.fieldCreationSideEffectService'),
  commandBus: Symbol('v2.core.commandBus'),
  queryBus: Symbol('v2.core.queryBus'),
  eventBus: Symbol('v2.core.eventBus'),
  unitOfWork: Symbol('v2.core.unitOfWork'),
  logger: Symbol('v2.core.logger'),
  tracer: Symbol('v2.core.tracer'),
} as const;
