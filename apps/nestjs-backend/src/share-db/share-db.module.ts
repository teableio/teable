import { Module } from '@nestjs/common';
import { AuthModule } from '../features/auth/auth.module';
import { SessionHandleModule } from '../features/auth/session/session-handle.module';
import { CalculationModule } from '../features/calculation/calculation.module';
import { ShareAuthModule } from '../features/share/share-auth.module';
import { TableModule } from '../features/table/table.module';
import { UserModule } from '../features/user/user.module';
import { ShareDbPermissionService } from './share-db-permission.service';
import { ShareDbAdapter } from './share-db.adapter';
import { ShareDbService } from './share-db.service';
import { WsAuthService } from './ws-auth.service';
import { WsDerivateService } from './ws-derivate.service';

@Module({
  imports: [
    TableModule,
    CalculationModule,
    AuthModule,
    UserModule,
    ShareAuthModule,
    SessionHandleModule,
  ],
  providers: [
    ShareDbService,
    ShareDbAdapter,
    WsDerivateService,
    WsAuthService,
    ShareDbPermissionService,
  ],
  exports: [ShareDbService, WsAuthService],
})
export class ShareDbModule {}
