import { Module } from '@nestjs/common';
import { ShareDbModule } from '../../../share-db/share-db.module';
import { ViewModule } from '../view.module';
import { ViewOpenApiController } from './view-open-api.controller';
import { ViewOpenApiService } from './view-open-api.service';

@Module({
  imports: [ViewModule, ShareDbModule],
  controllers: [ViewOpenApiController],
  providers: [ViewOpenApiService],
})
export class ViewOpenApiModule {}
