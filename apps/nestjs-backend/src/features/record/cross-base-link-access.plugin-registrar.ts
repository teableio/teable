import { Injectable } from '@nestjs/common';
import {
  RecordWriteOperationKind,
  registerFieldOperationPlugin,
  registerRecordWritePlugin,
  v2CoreTokens,
  type IRecordWritePlugin,
  type RecordWriteSideEffectService,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import { PermissionService } from '../auth/permission.service';
import { FieldSupplementService } from '../field/field-calculate/field-supplement.service';
import { V2ProjectionRegistrar, type IV2ProjectionRegistrar } from '../v2/v2-projection-registrar';
import { CrossBaseLinkAccessFieldOperationPlugin } from './cross-base-link-access.field-operation.plugin';
import { CrossBaseLinkAccessRecordWritePlugin } from './cross-base-link-access.record-write.plugin';
import { CrossBaseLinkAccessService } from './cross-base-link-access.service';
import { LinkTitleRecordCreatePermissionPlugin } from './link-title-record-create-permission.plugin';
import { SymmetricFieldPermissionFieldOperationPlugin } from './symmetric-field-permission.field-operation.plugin';
import { SymmetricFieldTargetSchemaCapabilityProvider } from './symmetric-field-target-schema-capability.service';

/**
 * Registers the cross-base link guards on every v2 container: the shared one,
 * the meta fallback and each BYODB data DB. Containers are built per data DB, so
 * the plugins have to be added at registration time rather than once at
 * bootstrap.
 *
 * Record writes and field operations are separate plugin ports, so both are
 * registered here to keep one piece of code answering "who checks cross-base
 * reach".
 */
@V2ProjectionRegistrar()
@Injectable()
export class CrossBaseLinkAccessPluginRegistrar implements IV2ProjectionRegistrar {
  private hostRecordCreatePolicy?: IRecordWritePlugin;

  constructor(
    private readonly crossBaseLinkAccess: CrossBaseLinkAccessService,
    private readonly fieldSupplementService: FieldSupplementService,
    private readonly targetSchemaCapability: SymmetricFieldTargetSchemaCapabilityProvider,
    private readonly cls: ClsService<IClsStore>,
    private readonly permissionService: PermissionService
  ) {}

  /** Install before container creation, just like the target-schema capability. */
  installHostRecordCreatePolicy(plugin: IRecordWritePlugin): void {
    if (!plugin.supports(RecordWriteOperationKind.createMany)) {
      throw new Error('The host record-create policy must support createMany');
    }
    if (this.hostRecordCreatePolicy && this.hostRecordCreatePolicy !== plugin) {
      throw new Error('The host record-create policy is already installed');
    }
    this.hostRecordCreatePolicy = plugin;
  }

  registerProjections(container: DependencyContainer): void {
    // Register the actual user policy before deferring to it. Registration is
    // name-idempotent, so the EE registrar can also register the same instance.
    if (this.hostRecordCreatePolicy) {
      const registration = registerRecordWritePlugin(container, this.hostRecordCreatePolicy, {
        source: CrossBaseLinkAccessPluginRegistrar.name,
      });
      if (registration.plugin !== this.hostRecordCreatePolicy) {
        throw new Error('The registered host record-create policy does not match');
      }
    }
    registerRecordWritePlugin(
      container,
      new LinkTitleRecordCreatePermissionPlugin(
        this.permissionService,
        this.cls,
        Boolean(this.hostRecordCreatePolicy),
        this.targetSchemaCapability,
        container.resolve<RecordWriteSideEffectService>(v2CoreTokens.recordWriteSideEffectService)
      ),
      { source: CrossBaseLinkAccessPluginRegistrar.name }
    );
    registerRecordWritePlugin(
      container,
      new CrossBaseLinkAccessRecordWritePlugin(this.crossBaseLinkAccess),
      { source: CrossBaseLinkAccessPluginRegistrar.name }
    );
    registerFieldOperationPlugin(
      container,
      new CrossBaseLinkAccessFieldOperationPlugin(this.fieldSupplementService),
      { source: CrossBaseLinkAccessPluginRegistrar.name }
    );
    registerFieldOperationPlugin(
      container,
      new SymmetricFieldPermissionFieldOperationPlugin(this.targetSchemaCapability, this.cls),
      { source: CrossBaseLinkAccessPluginRegistrar.name }
    );
  }
}
