import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { SYSTEM_USER_ID } from '@teable/core';
import { SsaConfig } from '../../configs/ssa.config';
import type { ISsaConfig } from '../../configs/ssa.config';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { Public } from '../auth/decorators/public.decorator';
import { NotificationService } from '../notification/notification.service';
import { ssaNotifyRoSchema } from './ssa-notify.dto';
import type { ISsaNotifyRo } from './ssa-notify.dto';
import { SsaTokenGuard } from './ssa-token.guard';

/**
 * Internal API for SSA companion services (notify/ai/voice). Everything here
 * is `@Public()` for the *user* auth guard but protected by the shared-secret
 * `SsaTokenGuard` instead; with no token configured the routes fail closed.
 */
@Controller('api/ssa')
@Public()
@UseGuards(SsaTokenGuard)
export class SsaController {
  constructor(
    @SsaConfig() private readonly ssaConfig: ISsaConfig,
    private readonly notificationService: NotificationService
  ) {}

  /** Liveness/config probe for companion services. */
  @Get('health')
  health(): {
    ok: boolean;
    singleTenant: boolean;
    eventsForwarding: boolean;
    timestamp: string;
  } {
    return {
      ok: true,
      singleTenant: this.ssaConfig.singleTenant,
      eventsForwarding: Boolean(this.ssaConfig.events.webhookUrl),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Creates an in-app (bell) notification and pushes it over the realtime
   * channel. Optionally emails the recipients when `emailConfig` exists on
   * their profile — emails are handled by the notify service itself.
   */
  @Post('notify')
  @HttpCode(200)
  async notify(@Body(new ZodValidationPipe(ssaNotifyRoSchema)) ro: ISsaNotifyRo) {
    return this.notificationService.sendCommonNotify({
      toUserId: ro.toUserId,
      toEmail: ro.toEmail,
      message: ro.message,
      severity: ro.severity,
      path: ro.path,
      fromUserId: ro.fromUserId ?? SYSTEM_USER_ID,
    });
  }
}
