import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { FieldModule } from '../field/field.module';
import { ViewModule } from '../view/view.module';
import { TableController } from './table.controller';
import { TableService } from './table.service';

@Module({
  imports: [ViewModule, FieldModule],
  controllers: [TableController],
  providers: [TableService, PrismaService],
})
export class TableModule {}
