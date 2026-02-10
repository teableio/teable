import type { Action, IFieldVo } from '@teable/core';
import type { Prisma } from '@teable/db-main-prisma';
import type { V2Feature } from '@teable/openapi';
import type { ClsStore } from 'nestjs-cls';
import type { IWorkflowContext } from '../features/auth/strategies/types';
import type { IPerformanceCacheStore } from '../performance-cache';
import type { IRawOpMap } from '../share-db/interface';
import type { IDataLoaderCache } from './data-loader';

export type V2Reason =
  | 'env_force_v2_all'
  | 'config_force_v2_all'
  | 'header_override'
  | 'space_feature'
  | 'disabled'
  | 'feature_not_enabled'
  | 'no_feature';

export interface IClsStore extends ClsStore {
  user: {
    id: string;
    name: string;
    email: string;
    isAdmin?: boolean | null;
  };
  accessTokenId?: string;
  // for template authentication
  template?: {
    id: string;
    baseId: string;
  };
  entry?: {
    type: string;
    id: string;
  };
  origin: {
    ip: string;
    byApi: boolean;
    userAgent: string;
    referer: string;
  };
  tx: {
    client?: Prisma.TransactionClient;
    timeStr?: string;
    id?: string;
    rawOpMaps?: IRawOpMap[];
  };
  shareViewId?: string;
  permissions: Action[];
  // this is used to check if the user is in the space when the user operate in a space
  spaceId?: string;
  // for share db adapter
  cookie?: string;
  oldField?: IFieldVo;
  organization?: {
    id: string;
    name: string;
    isAdmin: boolean;
    departments?: {
      id: string;
      name: string;
    }[];
  };
  tempAuthBaseId?: string; // for automation robot
  skipRecordAuditLog?: boolean; // skip individual record audit logs for automation
  appId?: string; // for app internal call
  workflowContext?: IWorkflowContext;
  dataLoaderCache?: IDataLoaderCache;
  clearCacheKeys?: (keyof IPerformanceCacheStore)[];
  canaryHeader?: string; // x-canary header value for canary release override
  useV2?: boolean; // Flag to indicate if V2 implementation should be used (set by V2FeatureGuard)
  v2Reason?: V2Reason; // Reason why V2 was enabled or disabled
  v2Feature?: V2Feature; // The feature name that triggered V2 check
  windowId?: string; // Window ID from x-window-id header for undo/redo tracking
}
