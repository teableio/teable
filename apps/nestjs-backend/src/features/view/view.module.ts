import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { ViewController } from './view.controller';
import { ViewService } from './view.service';

@Module({
  providers: [ViewService, PrismaService],
  controllers: [ViewController],
  exports: [ViewService],
})
export class ViewModule {}
