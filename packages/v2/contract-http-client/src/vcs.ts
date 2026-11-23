import { ORPCError, createORPCClient, createORPCErrorFromJson } from '@orpc/client';
import type { ContractRouterClient } from '@orpc/contract';
import { OpenAPILink } from '@orpc/openapi-client/fetch';
import { v2VcsContract } from '@teable/v2-contract-http/vcs';
import {
  err,
  ok,
  vcsDomainError,
  type DomainError,
  type IBaseVcsSnapshot,
  type ICloneSnapshotOptions,
  type IVcsCloneRecordsChunk,
  type IVcsHeadInfo,
  type IVcsIncrementalChanges,
  type IVcsPushCasConflict,
  type IVcsPushRequest,
  type IVcsPushResult,
  type IVcsRemoteGateway,
  type Result,
} from '@teable/v2-vcs';

import { decodeStandardV2ErrorBody, inferErrorCode } from './errorDecoder';
import type { IV2HttpClientOptions } from './index';

export { v2VcsContract } from '@teable/v2-contract-http/vcs';
export type V2VcsHttpClient = ContractRouterClient<typeof v2VcsContract>;

const EMPTY_PATCH_SUMMARY = {
  tablesAdded: 0,
  tablesDeleted: 0,
  tablesRenamed: 0,
  fieldsAdded: 0,
  fieldsUpdated: 0,
  fieldsDeleted: 0,
  viewsAdded: 0,
  viewsUpdated: 0,
  viewsDeleted: 0,
  recordsAdded: 0,
  recordsUpdated: 0,
  recordsDeleted: 0,
  cellChanges: 0,
} as const;

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const trimTrailingSlash = (url: string): string => url.trim().replace(/\/+$/, '');

const decodeVcsErrorResponse = (body: unknown, status: number) => {
  if (
    status === 409 &&
    isPlainRecord(body) &&
    typeof body.ok === 'boolean' &&
    isPlainRecord(body.conflictError)
  ) {
    const conflictMessage =
      typeof body.conflictError.message === 'string' ? body.conflictError.message : 'VCS conflict';
    return createORPCErrorFromJson({
      defined: false,
      code: 'CONFLICT',
      status: 409,
      message: conflictMessage,
      data: { conflictResult: body },
    });
  }

  const standard = decodeStandardV2ErrorBody(body, status);
  if (standard) return standard;

  if (isPlainRecord(body) && typeof body.message === 'string') {
    return createORPCErrorFromJson({
      defined: false,
      code: inferErrorCode(status),
      status,
      message: body.message,
      data: {},
    });
  }

  return null;
};

export const createVcsHttpClient = (options: IV2HttpClientOptions): V2VcsHttpClient => {
  const link = new OpenAPILink(v2VcsContract, {
    url: trimTrailingSlash(options.baseUrl),
    headers: options.headers,
    fetch: options.fetch,
    customErrorResponseBodyDecoder: (body, response) =>
      decodeVcsErrorResponse(body, response.status),
  });
  return createORPCClient(link) as V2VcsHttpClient;
};

interface IParsedOrpcData {
  readonly domainErrorCode?: string;
  readonly details?: Record<string, unknown>;
  readonly conflictResult?: IVcsPushResult;
}

const mapStatusToDomainError = (
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>
): DomainError => {
  if (status === 401) return vcsDomainError.unauthorized({ code, message, details });
  if (status === 403) return vcsDomainError.forbidden({ code, message, details });
  if (status === 404) return vcsDomainError.notFound({ code, message, details });
  if (status === 409) return vcsDomainError.conflict({ code, message, details });
  if (status === 400) return vcsDomainError.validation({ code, message, details });
  return vcsDomainError.infrastructure({ code, message, details });
};

const extractPushConflictResult = (
  request: IVcsPushRequest,
  orpcError: ORPCError<string, unknown>
): IVcsPushResult | undefined => {
  if (orpcError.status !== 409 || !isPlainRecord(orpcError.data)) {
    return undefined;
  }
  const data = orpcError.data as IParsedOrpcData;
  if (data.conflictResult && isPlainRecord(data.conflictResult.conflictError)) {
    return data.conflictResult;
  }
  if (
    data.domainErrorCode !== 'vcs.cas_conflict' &&
    data.domainErrorCode !== 'vcs.non_fast_forward'
  ) {
    return undefined;
  }
  const details = isPlainRecord(data.details) ? data.details : {};
  const headRevision =
    typeof details.headRevision === 'number' ? details.headRevision : request.baseRevision;
  const overlappingKeys = Array.isArray(details.overlappingKeys)
    ? details.overlappingKeys.filter((item): item is string => typeof item === 'string')
    : [];
  const conflicts = Array.isArray(details.conflicts)
    ? (details.conflicts as IVcsPushCasConflict[])
    : undefined;

  return {
    ok: false,
    dryRun: Boolean(request.dryRun),
    baseId: request.baseId,
    baseRevision: request.baseRevision,
    newRevision: headRevision,
    rebased: false,
    summary: EMPTY_PATCH_SUMMARY,
    conflictError: {
      code: data.domainErrorCode,
      message: orpcError.message,
      headRevision,
      overlappingKeys,
      ...(conflicts ? { conflicts } : {}),
    },
  };
};

const toGatewayDomainError = (error: unknown, contextLabel: string): DomainError => {
  if (error instanceof ORPCError) {
    const data = isPlainRecord(error.data) ? (error.data as IParsedOrpcData) : undefined;
    const code = data?.domainErrorCode ?? `HTTP_${error.status}`;
    return mapStatusToDomainError(error.status, code, error.message, data?.details);
  }
  const message = error instanceof Error ? error.message : String(error);
  return vcsDomainError.infrastructure({
    code: 'vcs.network_error',
    message: `VCS request (${contextLabel}) failed: ${message}`,
  });
};

export interface IContractHttpVcsNotFoundFallback {
  getHead?(baseId: string): Promise<Result<IVcsHeadInfo, DomainError>>;
  cloneSnapshot?(
    baseId: string,
    options?: ICloneSnapshotOptions
  ): Promise<
    Result<{ snapshot: IBaseVcsSnapshot; remoteMode: IVcsHeadInfo['remoteMode'] }, DomainError>
  >;
  cloneTableRecordsChunk?(
    baseId: string,
    tableId: string,
    options?: { readonly cursor?: string; readonly limit?: number }
  ): Promise<Result<IVcsCloneRecordsChunk, DomainError>>;
}

export interface IContractHttpVcsRemoteGatewayOptions {
  /** Base endpoint (e.g. https://app.teable.ai) or full v2 root if isV2BaseUrl is true. */
  readonly endpoint: string;
  readonly isV2BaseUrl?: boolean;
  readonly headers?:
    | Record<string, string>
    | (() => Record<string, string> | Promise<Record<string, string>>);
  readonly fetch?: typeof fetch;
  readonly onNotFoundFallback?: IContractHttpVcsNotFoundFallback;
}

export class ContractHttpVcsRemoteGateway implements IVcsRemoteGateway {
  private readonly client: V2VcsHttpClient;
  private readonly onNotFoundFallback?: IContractHttpVcsNotFoundFallback;

  constructor(options: IContractHttpVcsRemoteGatewayOptions) {
    const cleanEndpoint = trimTrailingSlash(options.endpoint);
    const v2BaseUrl = options.isV2BaseUrl ? cleanEndpoint : `${cleanEndpoint}/api/v2`;
    this.client = createVcsHttpClient({
      baseUrl: v2BaseUrl,
      headers: options.headers,
      fetch: options.fetch,
    });
    this.onNotFoundFallback = options.onNotFoundFallback;
  }

  async getHead(baseId: string): Promise<Result<IVcsHeadInfo, DomainError>> {
    try {
      const head = await this.client.head({ baseId });
      return ok(head);
    } catch (error) {
      if (error instanceof ORPCError && error.status === 404 && this.onNotFoundFallback?.getHead) {
        return this.onNotFoundFallback.getHead(baseId);
      }
      return err(toGatewayDomainError(error, 'head'));
    }
  }

  async enableBaseVcs(
    baseId: string
  ): Promise<Result<{ readonly enabled: boolean; readonly headRevision: number }, DomainError>> {
    try {
      const enabled = await this.client.enable({ baseId });
      return ok({
        enabled: enabled.enabled,
        headRevision: enabled.headRevision,
      });
    } catch (error) {
      return err(toGatewayDomainError(error, 'enable'));
    }
  }

  async cloneSnapshot(
    baseId: string,
    options?: ICloneSnapshotOptions
  ): Promise<
    Result<{ snapshot: IBaseVcsSnapshot; remoteMode: IVcsHeadInfo['remoteMode'] }, DomainError>
  > {
    try {
      const cloned = await this.client.clone({
        baseId,
        ...(options?.tableIds?.length ? { tableIds: [...options.tableIds] } : {}),
        ...(options?.includeRecords !== undefined
          ? { includeRecords: options.includeRecords }
          : {}),
      });
      return ok(cloned);
    } catch (error) {
      if (
        error instanceof ORPCError &&
        error.status === 404 &&
        this.onNotFoundFallback?.cloneSnapshot
      ) {
        return this.onNotFoundFallback.cloneSnapshot(baseId, options);
      }
      return err(toGatewayDomainError(error, 'clone'));
    }
  }

  async cloneTableRecordsChunk(
    baseId: string,
    tableId: string,
    options?: { readonly cursor?: string; readonly limit?: number }
  ): Promise<Result<IVcsCloneRecordsChunk, DomainError>> {
    try {
      const chunk = await this.client.cloneRecords({
        baseId,
        tableId,
        ...(options?.cursor ? { cursor: options.cursor } : {}),
        ...(options?.limit !== undefined ? { limit: options.limit } : {}),
      });
      return ok(chunk);
    } catch (error) {
      if (
        error instanceof ORPCError &&
        error.status === 404 &&
        this.onNotFoundFallback?.cloneTableRecordsChunk
      ) {
        return this.onNotFoundFallback.cloneTableRecordsChunk(baseId, tableId, options);
      }
      return err(toGatewayDomainError(error, 'cloneRecords'));
    }
  }

  async fetchChanges(
    baseId: string,
    sinceRevision: number,
    options?: ICloneSnapshotOptions
  ): Promise<Result<IVcsIncrementalChanges, DomainError>> {
    if (!options?.cursor) {
      const clonedRes = await this.cloneSnapshot(baseId, options);
      if (clonedRes.isErr()) return err(clonedRes.error);
      const { snapshot } = clonedRes.value;
      return ok({
        baseId: snapshot.baseId,
        baseName: snapshot.baseName,
        fromRevision: sinceRevision,
        toRevision: snapshot.revision,
        ...(snapshot.cursor ? { nextCursor: snapshot.cursor } : {}),
        hasChanges: true,
        requiresFullSync: true,
        fullSnapshot: snapshot,
        upsertedTables: [],
        deletedTableIds: [],
        recordDeltas: [],
        ...(snapshot.accessScope ? { accessScope: snapshot.accessScope } : {}),
      });
    }

    try {
      const changes = await this.client.changes({
        baseId,
        cursor: options.cursor,
        since: sinceRevision,
        ...(options.tableIds?.length ? { tableIds: [...options.tableIds] } : {}),
      });
      return ok(changes);
    } catch (error) {
      return err(toGatewayDomainError(error, 'changes'));
    }
  }

  async pushPatch(request: IVcsPushRequest): Promise<Result<IVcsPushResult, DomainError>> {
    try {
      const pushed = await this.client.push({
        baseId: request.baseId,
        baseRevision: request.baseRevision,
        patch: request.patch,
        ...(request.message !== undefined ? { message: request.message } : {}),
        ...(request.dryRun !== undefined ? { dryRun: request.dryRun } : {}),
        ...(request.originPushId !== undefined ? { originPushId: request.originPushId } : {}),
      });
      return ok(pushed);
    } catch (error) {
      if (error instanceof ORPCError) {
        const conflict = extractPushConflictResult(request, error);
        if (conflict) {
          return ok(conflict);
        }
      }
      return err(toGatewayDomainError(error, 'push'));
    }
  }
}
