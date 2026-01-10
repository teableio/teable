import type { DependencyContainer } from '@teable/v2-di';
import { Lifecycle, container } from '@teable/v2-di';

import { PostgresDebugMetaStore } from '../adapters/postgres/PostgresDebugMetaStore';
import { PostgresDebugRecordStore } from '../adapters/postgres/PostgresDebugRecordStore';
import { PostgresFieldRelationGraph } from '../adapters/postgres/PostgresFieldRelationGraph';
import type { IDebugMetaStore } from '../ports/DebugMetaStore';
import type { IDebugRecordStore } from '../ports/DebugRecordStore';
import type { IDebugFieldRelationGraph } from '../ports/FieldRelationGraph';
import { DebugDataService } from '../service/DebugDataService';
import { v2DebugDataTokens } from './tokens';

export type V2DebugDataRegistrationOptions = {
  metaStore?: IDebugMetaStore;
  recordStore?: IDebugRecordStore;
  relationGraph?: IDebugFieldRelationGraph;
};

export const registerV2DebugData = (
  c: DependencyContainer = container,
  options: V2DebugDataRegistrationOptions = {}
): DependencyContainer => {
  if (options.metaStore) {
    c.registerInstance(v2DebugDataTokens.metaStore, options.metaStore);
  } else if (!c.isRegistered(v2DebugDataTokens.metaStore)) {
    c.register(v2DebugDataTokens.metaStore, PostgresDebugMetaStore, {
      lifecycle: Lifecycle.Singleton,
    });
  }

  if (options.recordStore) {
    c.registerInstance(v2DebugDataTokens.recordStore, options.recordStore);
  } else if (!c.isRegistered(v2DebugDataTokens.recordStore)) {
    c.register(v2DebugDataTokens.recordStore, PostgresDebugRecordStore, {
      lifecycle: Lifecycle.Singleton,
    });
  }

  if (options.relationGraph) {
    c.registerInstance(v2DebugDataTokens.relationGraph, options.relationGraph);
  } else if (!c.isRegistered(v2DebugDataTokens.relationGraph)) {
    c.register(v2DebugDataTokens.relationGraph, PostgresFieldRelationGraph, {
      lifecycle: Lifecycle.Singleton,
    });
  }

  if (!c.isRegistered(v2DebugDataTokens.debugDataService)) {
    c.register(v2DebugDataTokens.debugDataService, DebugDataService, {
      lifecycle: Lifecycle.Singleton,
    });
  }

  return c;
};
