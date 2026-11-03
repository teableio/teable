import { HttpException } from '@nestjs/common';
import type { Action } from '@teable/core';
import type { PreviewOperation } from '@teable/v2-command-explain';
import type { IOperationPreviewRequestDto } from '@teable/v2-contract-http';
import {
  collectFieldConversionForeignTableReferences,
  domainError,
  err,
  ok,
  type DomainError,
  type IExecutionContext,
  type Result,
  type Table,
  type UpdateFieldCommand,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';

import type { PermissionService } from '../auth/permission.service';

export const V2_OPERATION_PREVIEW_PERMISSIONS: Partial<
  Record<PreviewOperation, readonly Action[]>
> = {
  ['field.delete']: ['field|delete'],
  ['field.convert']: ['field|update'],
  ['table.delete']: ['table|delete'],
  ['table.duplicate']: ['table|create', 'table|read'],
  ['records.paste']: ['record|update'],
  ['records.bulkUpdate']: ['record|update'],
  ['records.bulkDelete']: ['record|delete'],
};

/** Preview authorization error for a PermissionService token/permission rejection. */
export const previewAuthorizationDomainError = (status: number): DomainError =>
  status === 401
    ? domainError.unauthorized({
        code: 'preview.authorization.unauthorized',
        message: 'Authentication is required to preview this operation.',
      })
    : domainError.forbidden({
        code: 'preview.authorization.forbidden',
        message: 'You do not have permission to preview this operation.',
      });

/**
 * Translate a foreign-table PermissionService rejection. Failures outside the authorization set
 * belong to the caller, so they return undefined and are rethrown unchanged.
 */
export const previewForeignTableAuthorizationFailure = (
  error: unknown
): DomainError | undefined => {
  if (!(error instanceof HttpException)) return undefined;
  const status = error.getStatus();
  if (status !== 401 && status !== 403 && status !== 404) return undefined;
  return previewAuthorizationDomainError(status);
};

/** Authorize the exact conversion read set before a planner can load any foreign metadata. */
export const authorizeFieldConversionForeignTables = async (
  command: UpdateFieldCommand,
  table: Table,
  permissionService: Pick<PermissionService, 'validPermissions'>,
  accessTokenId?: string
): Promise<Result<void, DomainError>> => {
  const previousField = table.getField((field) => field.id().equals(command.fieldId));
  if (previousField.isErr()) return err(previousField.error);
  const references = collectFieldConversionForeignTableReferences(command, previousField.value);
  if (references.isErr()) return err(references.error);

  const checkedTableIds = new Set<string>();
  for (const reference of references.value) {
    const foreignTableId = reference.foreignTableId.toString();
    if (checkedTableIds.has(foreignTableId)) continue;
    try {
      // PermissionService resolves the table's actual base and intersects the token ceiling.
      // The client's optional baseId is not evidence of access to this resource.
      await permissionService.validPermissions(foreignTableId, ['record|read'], accessTokenId);
    } catch (error) {
      const failure = previewForeignTableAuthorizationFailure(error);
      if (!failure) throw error;
      return err(failure);
    }
    checkedTableIds.add(foreignTableId);
  }
  return ok(undefined);
};

/**
 * Host admission for operation preview.
 *
 * The implementation must be observational and must run before a preview planner can read
 * metadata or records. It is intentionally separate from execution plugins: write plugins may
 * reserve quota, invoke hooks, or otherwise mutate host state.
 */
export interface IV2OperationPreviewAuthorization {
  authorize(
    context: IExecutionContext,
    request: IOperationPreviewRequestDto,
    container: DependencyContainer
  ): Promise<Result<void, DomainError>>;
}

export const V2_OPERATION_PREVIEW_AUTHORIZATION = Symbol('v2.operationPreview.authorization');
