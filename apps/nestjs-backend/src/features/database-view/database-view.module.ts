import { Module } from '@nestjs/common';
import { DbProvider } from '../../db-provider/db.provider';
import { V2Module } from '../v2/v2.module';
import { DatabaseViewService } from './database-view.service';

@Module({
  imports: [V2Module],
  providers: [DbProvider, DatabaseViewService],
})
export class DatabaseViewModule {}
