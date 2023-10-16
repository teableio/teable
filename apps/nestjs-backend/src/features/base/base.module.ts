import { Module } from '@nestjs/common';
import { DbProvider } from '../../db-provider/db.provider';
import { BaseController } from './base.controller';
import { BaseService } from './base.service';
import { DbConnectionService } from './db-connection.service';

@Module({
  controllers: [BaseController],
  providers: [DbProvider, BaseService, DbConnectionService],
})
export class BaseModule {}
