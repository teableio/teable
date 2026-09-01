import type { Action, IFieldVo, ISignupAttribution, MarketingAdConsent } from '@teable/core';
import type { Prisma } from '@teable/db-main-prisma';
import type { V2Feature } from '@teable/openapi';
import type {
  ExecutionContextBackgroundTaskScheduler,
  IRecordRemovalReason,
} from '@teable/v2-core';
import type { ClsStore } from 'nestjs-cls';
import type { IAuditOperation } from '../features/audit/audit-scope';
import type { IWorkflowContext } from '../features/auth/strategies/types';
import type { IPerformanceCacheStore } from '../performance-cache';
import type { IRawOpMap } from '../share-db/interface';
import type { IDataLoaderCache } from './data-loader';

export type IV2Reason =
  | 'env_force_v2_all'
  | 'config_force_v2_all'
  | 'new_base'
  | 'header_override'
  | 'space_feature'
  | 'unsupported_feature'
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
  // for base share context (truthy = share mode, baseId for permission check, nodeId for node filtering)
  baseShare?: {
    baseId: string;
    nodeId: string | null;
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
    // The API endpoint the caller hit (`referer` is the frontend page, not the request).
    // Optional: non-HTTP entry points (import/base-import workers, robot agent) rebuild
    // `origin` from stored job data and have no request of their own.
    method?: string;
    path?: string;
    // Provenance/initiator of the request — orthogonal to byApi (auth method).
    // 'ai' / 'automation' set by RequestInfoMiddleware from x-ai-internal /
    // x-automation-internal headers. 'app' set by JwtStrategy after App-token auth.
    // Queries: `WHERE origin->>'via' = 'app'` etc. Extensible (webhook/mcp/...).
    // The actor identity (e.g. which app) lives in payload.appId, not here —
    // origin describes how the request arrived, not who performed it.
    via?: 'ai' | 'automation' | 'app';
  };
  // Affiliate token from the first-party teable_affiliate_via cookie (NOT origin.via
  // above) — see apps/nextjs-app/src/lib/affiliate-cookie.ts for the contract.
  affiliateVia?: string;
  // First-touch utm/click-id params (teable_attribution cookie) + Meta pixel
  // cookies, parsed by RequestInfoMiddleware on every request but consumed only
  // once, at account creation (user.service withAttribution → refMeta).
  // Contract: @teable/core attribution.ts.
  signupAttribution?: ISignupAttribution;
  // Banner ad_storage choice (teable_consent parent-domain cookie), parsed by
  // RequestInfoMiddleware; consumed at account creation to scope what may be
  // forwarded to ad platforms for EEA users. undefined = no banner choice.
  marketingAdConsent?: MarketingAdConsent;
  // OAuth login destination from the verified oauth state — the only
  // signup-time invite signal on OAuth paths (OauthStoreService.verify).
  oauthRedirectUri?: string;
  tx: {
    client?: Prisma.TransactionClient;
    timeStr?: string;
    id?: string;
    rawOpMaps?: IRawOpMap[];
  };
  dataTx?: {
    client?: Prisma.TransactionClient;
    timeStr?: string;
    id?: string;
  };
  shareViewId?: string;
  baseShareId?: string;
  permissions: Action[];
  // this is used to check if the user is in the space when the user operate in a space
  spaceId?: string;
  dataDb?: {
    mode: 'byodb';
    spaceId: string;
    connectionId: string;
    urlFingerprint?: string | null;
    displayHost?: string | null;
    displayDatabase?: string | null;
    internalSchema?: string | null;
  };
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
  appId?: string; // for app internal call
  // Active audit operation attribution. Outer-wins: the first withOperation() call sets
  // rootAction/operationId; downstream atomic audit rows keep their own `action` and copy
  // this operation into `payload.rootAction`.
  audit?: IAuditOperation;
  workflowContext?: IWorkflowContext;
  dataLoaderCache?: IDataLoaderCache;
  clearCacheKeys?: (keyof IPerformanceCacheStore)[];
  canaryHeader?: string; // x-canary header value for canary release override
  scheduleV2BackgroundTask?: ExecutionContextBackgroundTaskScheduler;
  useV2?: boolean; // Flag to indicate if V2 implementation should be used (set by V2FeatureGuard)
  v2Reason?: IV2Reason; // Reason why V2 was enabled or disabled
  v2Feature?: V2Feature; // The feature name that triggered V2 check
  windowId?: string; // Window ID from x-window-id header for undo/redo tracking
  recordRemovalReason?: IRecordRemovalReason; // set by the archive flow; flows into op events
  // cache for base share node tree (to avoid repeated queries within same request)
  baseShareNodeCache?: Map<
    string,
    { id: string; parentId: string | null; resourceType: string; resourceId: string | null }[]
  >;
  // cache for share-view scope resolution (one record write often triggers
  // multiple assert* calls; this dedupes the view + field lookups per request).
  // Type is `unknown` here to avoid a circular import with the record feature.
  // Keep values bounded — only store structured metadata (view config, field
  // list), never record payloads or unbounded user input.
  shareViewScopeCache?: Map<string, unknown>;
  // cache for data-db routing resolution (table/base → spaceId, space → resolved
  // data db). One request resolves the same routing several times across guards,
  // container lookup, and query paths; this dedupes the meta-db lookups.
  // Type is `unknown` to avoid importing the resolver types here.
  dataDbRoutingCache?: Map<string, unknown>;
  // cache for table → base → space ancestry rows shared across guards and
  // permission checks (see utils/meta-ancestry-cache.ts). Stores full rows
  // including soft-deleted ones; callers apply their own deletedTime filters.
  metaAncestryCache?: Map<string, unknown>;
}
