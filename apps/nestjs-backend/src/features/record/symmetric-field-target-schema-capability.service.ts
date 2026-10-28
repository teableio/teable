import { Injectable } from '@nestjs/common';
import type { FieldAction } from '@teable/core';
import {
  ok,
  type ActorId,
  type DomainError,
  type PluginTraceContext,
  type Result,
  type Table,
} from '@teable/v2-core';
import { PermissionService } from '../auth/permission.service';

export interface ISymmetricFieldTargetSchemaCapability {
  canManageTargetSchema(
    table: Table,
    actorId: ActorId,
    trace: PluginTraceContext | undefined,
    action: FieldAction,
    accessTokenId: string | undefined
  ): Promise<Result<boolean, DomainError>>;
}

/**
 * Community target-schema policy and the host seam used by enterprise.
 * Enterprise replaces the implementation once during Nest composition, before
 * V2 containers are initialized; every container keeps this stable provider.
 */
@Injectable()
export class SymmetricFieldTargetSchemaCapabilityProvider implements ISymmetricFieldTargetSchemaCapability {
  private hostCapability?: ISymmetricFieldTargetSchemaCapability;

  constructor(private readonly permissionService: PermissionService) {}

  installHostCapability(capability: ISymmetricFieldTargetSchemaCapability): void {
    if (this.hostCapability && this.hostCapability !== capability) {
      throw new Error('Symmetric field target-schema capability is already installed');
    }
    this.hostCapability = capability;
  }

  async canManageTargetSchema(
    table: Table,
    actorId: ActorId,
    trace: PluginTraceContext | undefined,
    action: FieldAction,
    accessTokenId: string | undefined
  ): Promise<Result<boolean, DomainError>> {
    if (this.hostCapability) {
      return this.hostCapability.canManageTargetSchema(
        table,
        actorId,
        trace,
        action,
        accessTokenId
      );
    }

    await this.permissionService.validPermissions(table.id().toString(), [action], accessTokenId);
    return ok(true);
  }
}
