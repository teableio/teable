import { Module } from '@nestjs/common';
import { BaseSqlExecutorService } from './base-sql-executor.service';

@Module({
  providers: [BaseSqlExecutorService],
  exports: [BaseSqlExecutorService],
})
export class BaseSqlExecutorModule {}
