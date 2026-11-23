import type { IInplaceImportOptionRo } from '@teable/openapi';
import type { IClsStore } from '../../../types/cls';
import type { IQueuedCredentialCeiling } from '../../auth/queued-credential-ceiling';

export const V2_IMPORT_WORKFLOW_QUEUE = 'v2-uploaded-file-import';

/** Only server-established principal/provenance, never request bodies or cached permissions. */
export type IV2ImportPrincipal = Pick<
  IClsStore,
  | 'user'
  | 'accessTokenId'
  | 'origin'
  | 'entry'
  | 'tempAuthBaseId'
  | 'authSource'
  | 'sandboxPrincipal'
  | 'appId'
  | 'workflowContext'
>;

export interface IV2ImportWorkflowJob {
  baseId: string;
  tableId: string;
  options: IInplaceImportOptionRo;
  principal: IV2ImportPrincipal;
  /** Captured by the enqueue host, never deserialized from the public request. */
  credentialCeiling?: IQueuedCredentialCeiling;
}

export interface IV2ImportWorkflowProgress {
  successCount: number;
  failedCount?: number;
  totalRows?: number;
}
