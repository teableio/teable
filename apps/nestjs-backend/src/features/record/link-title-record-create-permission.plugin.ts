import { isRobot, SYSTEM_USER_ID } from '@teable/core';
import {
  domainError,
  err,
  ok,
  RecordWriteOperationKind,
  type DomainError,
  type IDomainErrorLocalization,
  type IRecordWritePlugin,
  type RecordWritePluginContext,
  type RecordWriteSideEffectService,
  type Result,
} from '@teable/v2-core';
import type { ClsService } from 'nestjs-cls';
import { CustomHttpException } from '../../custom.exception';
import type { IClsStore } from '../../types/cls';
import type { PermissionService } from '../auth/permission.service';
import type { SymmetricFieldTargetSchemaCapabilityProvider } from './symmetric-field-target-schema-capability.service';

/**
 * A missing link title creates a row in a different authorization target from
 * the HTTP write. Direct createMany callers retain their existing contracts
 * (including table seeds and duplication authorized by table|create).
 */
export class LinkTitleRecordCreatePermissionPlugin implements IRecordWritePlugin<undefined> {
  readonly name = 'linkTitleRecordCreatePermission';
  readonly enforce = 'pre' as const;

  constructor(
    private readonly permissionService: PermissionService,
    private readonly cls: ClsService<IClsStore>,
    // The registrar only sets this after registering the host's actual write
    // plugin in the same container. That plugin owns user/table/field policy.
    private readonly hasHostUserPolicy: boolean,
    private readonly targetSchemaCapability: SymmetricFieldTargetSchemaCapabilityProvider,
    private readonly recordWriteSideEffectService: RecordWriteSideEffectService
  ) {}

  supports(operation: RecordWriteOperationKind): boolean {
    return operation === RecordWriteOperationKind.createMany;
  }

  async prepare(context: RecordWritePluginContext): Promise<Result<undefined, DomainError>> {
    if (
      context.kind !== RecordWriteOperationKind.createMany ||
      !context.payload.linkTitleSource ||
      context.payload.recordCount === 0
    ) {
      return ok(undefined);
    }

    const tableId = context.table.id().toString();
    const sourceBaseId = context.payload.linkTitleSource.baseId.toString();
    const details = {
      tableId,
      sourceBaseId,
      sourceTableId: context.payload.linkTitleSource.tableId.toString(),
      sourceFieldId: context.payload.linkTitleSource.fieldId.toString(),
      operation: context.kind,
    };
    const forbidden = (message: string) =>
      err(domainError.forbidden({ code: 'link_title.record_create_forbidden', message, details }));
    const userId = this.cls.get('user.id');
    const actorId = context.executionContext.actorId.toString();
    if (userId && userId !== actorId && actorId !== SYSTEM_USER_ID) {
      return forbidden('Link-title creation actor does not match the authenticated user');
    }

    try {
      // PAT limits apply independently of matrix grants and delegated scopes.
      const accessTokenId = this.cls.get('accessTokenId');
      if (accessTokenId) {
        const permissions = await this.permissionService.getPermissionsByAccessToken(
          tableId,
          accessTokenId
        );
        if (!permissions.includes('record|create')) {
          return forbidden(`Access token does not have record|create permission on ${tableId}`);
        }
      }

      const shareViewId = this.cls.get('shareViewId');
      const baseShareId = this.cls.get('baseShareId');
      if (shareViewId) {
        await this.permissionService.validShareViewPermissions(shareViewId, tableId, [
          'record|create',
        ]);
      } else if (baseShareId) {
        await this.permissionService.validBaseSharePermissions(baseShareId, tableId, [
          'record|create',
        ]);
      } else if (this.cls.get('baseShare')) {
        return forbidden('Link-title creation requires the authenticated project share identity');
      } else if (this.cls.get('template')) {
        await this.permissionService.validTemplatePermissions(tableId, ['record|create']);
      } else if (userId && isRobot(userId)) {
        // Only a real robot inherits temporary-base scope. Human JWT callers
        // remain governed by the installed host policy (the EE matrix when present).
        await this.permissionService.validPermissions(tableId, ['record|create']);
      } else if (userId && actorId !== SYSTEM_USER_ID && !this.hasHostUserPolicy) {
        await this.permissionService.validPermissions(tableId, ['record|create']);
      }

      // Missing CLS user / system actor are internal calls. HTTP contexts
      // require a user, while delegated scopes and PAT ceilings above remain.
    } catch (error) {
      if (!(error instanceof CustomHttpException)) {
        throw error;
      }
      const localization = error.data?.localization as IDomainErrorLocalization | undefined;
      return err(
        domainError.forbidden({
          code: 'link_title.record_create_forbidden',
          message: error.message,
          details,
          ...(localization ? { localization } : {}),
          cause: error,
        })
      );
    }

    return ok(undefined);
  }

  async afterGuard(context: RecordWritePluginContext): Promise<Result<void, DomainError>> {
    if (
      context.kind !== RecordWriteOperationKind.createMany ||
      !context.payload.linkTitleSource ||
      context.payload.recordCount === 0
    ) {
      return ok(undefined);
    }

    const tableId = context.table.id().toString();
    const sourceBaseId = context.payload.linkTitleSource.baseId.toString();
    const details = {
      tableId,
      sourceBaseId,
      sourceTableId: context.payload.linkTitleSource.tableId.toString(),
      sourceFieldId: context.payload.linkTitleSource.fieldId.toString(),
      operation: context.kind,
    };
    const userId = this.cls.get('user.id');
    const actorId = context.executionContext.actorId.toString();

    try {
      const accessTokenId = this.cls.get('accessTokenId');
      const shareViewId = this.cls.get('shareViewId');
      const baseShareId = this.cls.get('baseShareId');
      // Row and cell guards have finalized the payload before schema authorization.
      if (
        sourceBaseId !== context.table.baseId().toString() &&
        userId &&
        actorId !== SYSTEM_USER_ID
      ) {
        // Ignore the source request's cached choice-creation flag while probing
        // the foreign table. The actual target policy below owns this decision.
        const targetProbeContext = {
          ...context.executionContext,
          config: {
            ...context.executionContext.config,
            allowSelectOptionAutoCreate: undefined,
          },
        };
        const metadataUpdate = this.recordWriteSideEffectService.wouldUpdateTableMetadata(
          targetProbeContext,
          context.table,
          context.payload.recordsFieldValues,
          context.payload.typecast
        );
        if (metadataUpdate.isErr()) {
          return err(metadataUpdate.error);
        }
        if (metadataUpdate.value) {
          if (shareViewId) {
            await this.permissionService.validShareViewPermissions(shareViewId, tableId, [
              'field|update',
            ]);
          } else if (baseShareId) {
            await this.permissionService.validBaseSharePermissions(baseShareId, tableId, [
              'field|update',
            ]);
          } else if (this.cls.get('template')) {
            await this.permissionService.validTemplatePermissions(tableId, ['field|update']);
          } else if (isRobot(userId)) {
            await this.permissionService.validPermissions(tableId, ['field|update'], accessTokenId);
          } else {
            const capability = await this.targetSchemaCapability.canManageTargetSchema(
              context.table,
              context.executionContext.actorId,
              context.trace,
              'field|update',
              accessTokenId
            );
            if (capability.isErr()) {
              return err(capability.error);
            }
            if (!capability.value) {
              return err(
                domainError.forbidden({
                  code: 'link_title.record_create_forbidden',
                  message: `Field update is not allowed on ${tableId}`,
                  details,
                })
              );
            }
          }
          context.executionContext.config = {
            ...context.executionContext.config,
            allowSelectOptionAutoCreate: true,
          };
        }
      }
    } catch (error) {
      if (!(error instanceof CustomHttpException)) {
        throw error;
      }
      const localization = error.data?.localization as IDomainErrorLocalization | undefined;
      return err(
        domainError.forbidden({
          code: 'link_title.record_create_forbidden',
          message: error.message,
          details,
          ...(localization ? { localization } : {}),
          cause: error,
        })
      );
    }

    return ok(undefined);
  }
}
