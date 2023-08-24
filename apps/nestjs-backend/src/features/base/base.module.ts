import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { BaseController } from './base.controller';
import { BaseService } from './base.service';

@Module({
  controllers: [BaseController],
  providers: [PrismaService, BaseService],
})
export class BaseModule {}
