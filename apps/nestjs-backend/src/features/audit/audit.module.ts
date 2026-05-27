import { Global, Module } from '@nestjs/common';
import { AuditScope } from './audit-scope';

@Global()
@Module({
  providers: [AuditScope],
  exports: [AuditScope],
})
export class AuditSourceModule {}
