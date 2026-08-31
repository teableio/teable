import { Global, Module } from '@nestjs/common';
import { TeableJwtService } from './teable-jwt.service';

@Global()
@Module({
  providers: [TeableJwtService],
  exports: [TeableJwtService],
})
export class TeableJwtModule {}
