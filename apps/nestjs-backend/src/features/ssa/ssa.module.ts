import { Module } from '@nestjs/common';
import { NotificationModule } from '../notification/notification.module';
import { SettingModule } from '../setting/setting.module';
import { SsaAssistantController } from './ssa-assistant.controller';
import { SsaBootstrapService } from './ssa-bootstrap.service';
import { SsaEventForwarder } from './ssa-event-forwarder';
import { SsaEventsListener } from './ssa-events.listener';
import { SsaTokenGuard } from './ssa-token.guard';
import { V2SsaEventDispatcher, V2SsaProjectionRegistrar } from './ssa-v2-projections';
import { SsaController } from './ssa.controller';

/**
 * Fork-only module: SSA single-tenant extensions.
 *
 * M1 — single-tenant hardening (`SSA_SINGLE_TENANT`).
 * M2 — record-event forwarding (v1 listeners + v2 projections) and the
 *      internal notification API (`SSA_EVENTS_WEBHOOK_URL`, `SSA_INTERNAL_TOKEN`).
 * M4 — in-app assistant proxy (`SSA_ASSISTANT_ENABLED`, `SSA_ASSISTANT_SERVICE_URL`).
 */
@Module({
  imports: [SettingModule, NotificationModule],
  controllers: [SsaController, SsaAssistantController],
  providers: [
    SsaBootstrapService,
    SsaEventsListener,
    SsaTokenGuard,
    SsaEventForwarder,
    V2SsaEventDispatcher,
    V2SsaProjectionRegistrar,
  ],
})
export class SsaModule {}
