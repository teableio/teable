import type { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';

export const V2_CREATE_TABLE_LEGACY_EVENTS_CONTEXT_KEY =
  '__teable_v2_create_table_legacy_events_context';

type IV2CreateTableLegacyEventsClsStore = IClsStore & {
  [V2_CREATE_TABLE_LEGACY_EVENTS_CONTEXT_KEY]?: boolean;
};

export const getV2CreateTableLegacyEventsFlag = (cls: ClsService<IClsStore>): boolean => {
  return (
    (cls as ClsService<IV2CreateTableLegacyEventsClsStore>).get(
      V2_CREATE_TABLE_LEGACY_EVENTS_CONTEXT_KEY
    ) === true
  );
};

export const setV2CreateTableLegacyEventsFlag = (
  cls: ClsService<IClsStore>,
  value: boolean
): void => {
  (cls as ClsService<IV2CreateTableLegacyEventsClsStore>).set(
    V2_CREATE_TABLE_LEGACY_EVENTS_CONTEXT_KEY,
    value
  );
};
