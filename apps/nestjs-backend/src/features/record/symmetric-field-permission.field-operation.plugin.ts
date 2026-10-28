import { Injectable } from '@nestjs/common';
import { SYSTEM_USER_ID, type FieldAction } from '@teable/core';
import {
  domainError,
  err,
  FieldOperationKind,
  FieldOperationTargetKind,
  ok,
  type DomainError,
  type FieldOperationPluginContext,
  type IDomainErrorLocalization,
  type IFieldOperationPlugin,
  type Result,
} from '@teable/v2-core';
import { ClsService } from 'nestjs-cls';
import { CustomHttpException } from '../../custom.exception';
import type { IClsStore } from '../../types/cls';
import { SymmetricFieldTargetSchemaCapabilityProvider } from './symmetric-field-target-schema-capability.service';

export const SYMMETRIC_FIELD_PERMISSION_FIELD_OPERATION_PLUGIN_NAME =
  'symmetricFieldPermissionFieldOperation';
export const SYMMETRIC_FIELD_PERMISSION_FORBIDDEN =
  'cross_base_link.side_effect_field_operation_forbidden';

const fieldActionByOperation: Partial<Record<FieldOperationKind, FieldAction>> = {
  [FieldOperationKind.create]: 'field|create',
  [FieldOperationKind.update]: 'field|update',
  [FieldOperationKind.delete]: 'field|delete',
};

type PermissionDetails = {
  readonly operation: FieldOperationKind;
  readonly sourceOperation: FieldOperationKind;
  readonly sourceTableId: string;
  readonly targetTableId: string;
  readonly action: FieldAction;
};

const permissionDetails = (
  context: FieldOperationPluginContext,
  action: FieldAction
): PermissionDetails => ({
  operation: context.kind,
  sourceOperation: context.target.sourceOperation,
  sourceTableId: context.target.sourceTable.id().toString(),
  targetTableId: context.table.id().toString(),
  action,
});

const toPermissionDomainError = (
  error: CustomHttpException,
  details: PermissionDetails
): DomainError => {
  const localization = error.data?.localization as IDomainErrorLocalization | undefined;

  return domainError.forbidden({
    code: SYMMETRIC_FIELD_PERMISSION_FORBIDDEN,
    message: error.message,
    details,
    ...(localization ? { localization } : {}),
    cause: error,
  });
};

/**
 * Authorizes the actual target of reciprocal link-field schema changes.
 * Direct operations retain their route/host authorization, while same-base
 * side effects inherit the source base role and need no second role check.
 */
@Injectable()
export class SymmetricFieldPermissionFieldOperationPlugin implements IFieldOperationPlugin<undefined> {
  readonly name = SYMMETRIC_FIELD_PERMISSION_FIELD_OPERATION_PLUGIN_NAME;
  readonly enforce = 'pre' as const;

  constructor(
    private readonly targetSchemaCapability: SymmetricFieldTargetSchemaCapabilityProvider,
    private readonly cls: ClsService<IClsStore>
  ) {}

  supports(operation: FieldOperationKind): boolean {
    return fieldActionByOperation[operation] !== undefined;
  }

  async prepare(context: FieldOperationPluginContext): Promise<Result<undefined, DomainError>> {
    const action = fieldActionByOperation[context.kind];
    if (!action || context.target.kind !== FieldOperationTargetKind.sideEffect) {
      return ok(undefined);
    }

    const sourceBaseId = context.target.sourceTable.baseId().toString();
    const targetBaseId = context.table.baseId().toString();
    if (sourceBaseId === targetBaseId) {
      return ok(undefined);
    }

    const actorId = context.executionContext.actorId.toString();
    if (actorId === SYSTEM_USER_ID) {
      return ok(undefined);
    }

    const details = permissionDetails(context, action);
    const userId = this.cls.get('user.id');
    if (!userId || userId !== actorId) {
      return err(
        domainError.forbidden({
          code: SYMMETRIC_FIELD_PERMISSION_FORBIDDEN,
          message: `Field side-effect actor ${actorId} does not match the authenticated user`,
          details,
        })
      );
    }

    try {
      const capabilityResult = await this.targetSchemaCapability.canManageTargetSchema(
        context.table,
        context.executionContext.actorId,
        context.trace,
        action,
        this.cls.get('accessTokenId')
      );
      if (capabilityResult.isErr()) {
        return err(capabilityResult.error);
      }
      if (!capabilityResult.value) {
        return err(
          domainError.forbidden({
            code: SYMMETRIC_FIELD_PERMISSION_FORBIDDEN,
            message: `not allowed to operate ${action} on ${details.targetTableId}`,
            details,
          })
        );
      }
    } catch (error) {
      if (!(error instanceof CustomHttpException)) {
        throw error;
      }
      return err(toPermissionDomainError(error, details));
    }

    return ok(undefined);
  }
}
