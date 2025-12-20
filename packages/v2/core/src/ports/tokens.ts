export const v2CoreTokens = {
  tableRepository: Symbol('v2.core.tableRepository'),
  tableSchemaRepository: Symbol('v2.core.tableSchemaRepository'),
  commandBus: Symbol('v2.core.commandBus'),
  eventBus: Symbol('v2.core.eventBus'),
  unitOfWork: Symbol('v2.core.unitOfWork'),
  logger: Symbol('v2.core.logger'),
} as const;
