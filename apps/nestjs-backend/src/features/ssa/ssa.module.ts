import { Module } from '@nestjs/common';
import { SettingModule } from '../setting/setting.module';
import { SsaBootstrapService } from './ssa-bootstrap.service';

/**
 * Fork-only module: SSA single-tenant extensions.
 *
 * M1 — single-tenant hardening (`SSA_SINGLE_TENANT`).
 * M2 — record-event forwarder + internal notification API for companion services.
 */
@Module({
  imports: [SettingModule],
  providers: [SsaBootstrapService],
})
export class SsaModule {}
