import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { ViewService } from './view.service';

@Module({
  providers: [ViewService, PrismaService],
  exports: [ViewService, PrismaService],
})
export class ViewModule {}
