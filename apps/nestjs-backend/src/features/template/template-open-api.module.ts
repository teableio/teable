import { Module } from '@nestjs/common';
import { AttachmentsStorageModule } from '../attachments/attachments-storage.module';
import { BaseModule } from '../base/base.module';
import { TemplateOpenApiController } from './template-open-api.controller';
import { TemplateOpenApiService } from './template-open-api.service';
import { TemplatePermalinkService } from './template-permalink.service';

@Module({
  imports: [BaseModule, AttachmentsStorageModule],
  controllers: [TemplateOpenApiController],
  providers: [TemplateOpenApiService, TemplatePermalinkService],
  exports: [TemplateOpenApiService, TemplatePermalinkService],
})
export class TemplateOpenApiModule {}
