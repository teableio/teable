import { Module } from '@nestjs/common';
import { AuthModule } from '../features/auth/auth.module';
import { CalculationModule } from '../features/calculation/calculation.module';
import { TableModule } from '../features/table/table.module';
import { UserModule } from '../features/user/user.module';
import { WsDerivateService } from './ws-derivate.service';
import { ShareDbService } from './share-db.service';
import { SqliteDbAdapter } from './sqlite.adapter';
import { WsAuthService } from './ws-auth.service';

@Module({
  imports: [TableModule, CalculationModule, AuthModule, UserModule],
  providers: [ShareDbService, SqliteDbAdapter, WsDerivateService, WsAuthService],
  exports: [ShareDbService, WsAuthService],
})
export class ShareDbModule {}
