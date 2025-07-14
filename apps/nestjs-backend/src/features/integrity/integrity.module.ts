import { Module } from '@nestjs/common';
import { FieldModule } from '../field/field.module';
import { ForeignKeyIntegrityService } from './foreign-key.service';
import { IntegrityController } from './integrity.controller';
import { LinkFieldIntegrityService } from './link-field.service';
import { LinkIntegrityService } from './link-integrity.service';
import { UniqueIndexService } from './unique-index.service';

@Module({
  imports: [FieldModule],
  controllers: [IntegrityController],
  providers: [
    ForeignKeyIntegrityService,
    LinkFieldIntegrityService,
    LinkIntegrityService,
    UniqueIndexService,
  ],
  exports: [LinkIntegrityService],
})
export class IntegrityModule {}
