import { Injectable } from '@nestjs/common';
import { registerFieldOperationPlugin, registerRecordWritePlugin } from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { ClsService } from 'nestjs-cls';
import type { IClsStore } from '../../types/cls';
import { FieldSupplementService } from '../field/field-calculate/field-supplement.service';
import { V2ProjectionRegistrar, type IV2ProjectionRegistrar } from '../v2/v2-projection-registrar';
import { CrossBaseLinkAccessFieldOperationPlugin } from './cross-base-link-access.field-operation.plugin';
import { CrossBaseLinkAccessRecordWritePlugin } from './cross-base-link-access.record-write.plugin';
import { CrossBaseLinkAccessService } from './cross-base-link-access.service';
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
  constructor(
    private readonly crossBaseLinkAccess: CrossBaseLinkAccessService,
    private readonly fieldSupplementService: FieldSupplementService,
    private readonly targetSchemaCapability: SymmetricFieldTargetSchemaCapabilityProvider,
    private readonly cls: ClsService<IClsStore>
  ) {}

  registerProjections(container: DependencyContainer): void {
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
