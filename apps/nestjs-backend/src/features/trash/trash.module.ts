import { Module } from '@nestjs/common';
import { BaseModule } from '../base/base.module';
import { TableOpenApiModule } from '../table/open-api/table-open-api.module';
import { UserModule } from '../user/user.module';
import { TrashController } from './trash.controller';
import { TrashService } from './trash.service';

@Module({
  imports: [UserModule, BaseModule, TableOpenApiModule],
  controllers: [TrashController],
  providers: [TrashService],
  exports: [TrashService],
})
export class TrashModule {}
