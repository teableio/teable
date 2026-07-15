export const activeBaseDataDbMoveJobStates = [
  'pending',
  'waiting_worker',
  'copying_base_schema',
  'copying_shared_rows',
  'validating',
  'switching',
] as const;

export const cancelableBaseDataDbMoveJobStates = [
  'pending',
  'waiting_worker',
  'copying_base_schema',
  'copying_shared_rows',
  'validating',
] as const;

export const baseDataDbMovingErrorCode = 'BASE_DATA_DB_MOVING';

export const baseDataDbMoveProgressWeights = {
  preparing: 5,
  copying_base_schema: 55,
  copying_shared_rows: 15,
  validating: 15,
  switching: 10,
} as const;

export type IBaseDataDbMovePhase = keyof typeof baseDataDbMoveProgressWeights;
