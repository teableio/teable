import { Module } from '@nestjs/common';
import { ForeignKeyIntegrityService } from './foreign-key.service';
import { IntegrityController } from './integrity.controller';
import { LinkFieldIntegrityService } from './link-field.service';
import { LinkIntegrityService } from './link-integrity.service';

@Module({
  controllers: [IntegrityController],
  providers: [ForeignKeyIntegrityService, LinkFieldIntegrityService, LinkIntegrityService],
  exports: [LinkIntegrityService],
})
export class IntegrityModule {}
