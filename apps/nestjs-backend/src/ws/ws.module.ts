import { Module } from '@nestjs/common';
import { SessionHandleModule } from '../features/auth/session/session-handle.module';
import { ShareDbModule } from '../share-db/share-db.module';
import { WsGateway } from './ws.gateway';
import { DevWsGateway } from './ws.gateway.dev';
import { WsService } from './ws.service';

@Module({
  imports: [ShareDbModule, SessionHandleModule],
  providers: [WsService, process.env.NODE_ENV === 'production' ? WsGateway : DevWsGateway],
})
export class WsModule {}
