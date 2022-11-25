import { Module } from '@nestjs/common';
import { TeableController } from './teable.controller';

@Module({
  controllers: [TeableController]
})
export class TeableModule { }
