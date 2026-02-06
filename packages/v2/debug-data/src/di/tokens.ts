import { createToken } from '@teable/v2-di';

import type { IDebugMetaStore } from '../ports/DebugMetaStore';
import type { IDebugRecordStore } from '../ports/DebugRecordStore';
import type { IDebugFieldRelationGraph } from '../ports/FieldRelationGraph';
import type { DebugDataService } from '../service/DebugDataService';

export const v2DebugDataTokens = {
  metaStore: createToken<IDebugMetaStore>('v2.debugData.metaStore'),
  recordStore: createToken<IDebugRecordStore>('v2.debugData.recordStore'),
  relationGraph: createToken<IDebugFieldRelationGraph>('v2.debugData.relationGraph'),
  debugDataService: createToken<DebugDataService>('v2.debugData.service'),
} as const;
