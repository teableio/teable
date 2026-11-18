import { Module } from '@nestjs/common';
import { CrossBaseLinkAccessPluginRegistrar } from '../record/cross-base-link-access.plugin-registrar';
import { CrossBaseLinkAccessService } from '../record/cross-base-link-access.service';
import { SymmetricFieldTargetSchemaCapabilityProvider } from '../record/symmetric-field-target-schema-capability.service';
import { FieldReferenceAdmissionService } from './field-reference-admission.service';

/** Host-only policy ownership: no field execution, calculation or record-modify module. */
@Module({
  providers: [
    FieldReferenceAdmissionService,
    CrossBaseLinkAccessService,
    CrossBaseLinkAccessPluginRegistrar,
    SymmetricFieldTargetSchemaCapabilityProvider,
  ],
  exports: [
    FieldReferenceAdmissionService,
    CrossBaseLinkAccessService,
    CrossBaseLinkAccessPluginRegistrar,
    SymmetricFieldTargetSchemaCapabilityProvider,
  ],
})
export class FieldReferenceAdmissionModule {}
