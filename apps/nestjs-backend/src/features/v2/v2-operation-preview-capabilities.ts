import {
  CONVERT_FIELD,
  DELETE_FIELD,
  DELETE_TABLE,
  DUPLICATE_BASE,
  PASTE_URL,
} from '@teable/openapi';
import type { PreviewCapability, PreviewOperation } from '@teable/v2-command-explain';

const mountedWriteRoutes: Partial<Record<PreviewOperation, string>> = {
  'field.delete': `DELETE ${DELETE_FIELD}`,
  'field.convert': `PUT ${CONVERT_FIELD}`,
  'table.delete': `DELETE ${DELETE_TABLE}`,
  'records.paste': `PATCH ${PASTE_URL}`,
  'base.duplicate': `POST ${DUPLICATE_BASE}`,
};

/** Rebind transport-neutral capabilities to write routes mounted by the Nest host. */
export const withNestOperationPreviewRoutes = (
  capabilities: ReadonlyArray<PreviewCapability>
): ReadonlyArray<PreviewCapability> =>
  capabilities.map((capability) => ({
    ...capability,
    canonicalWriteRoute: mountedWriteRoutes[capability.operation] ?? capability.canonicalWriteRoute,
  }));
