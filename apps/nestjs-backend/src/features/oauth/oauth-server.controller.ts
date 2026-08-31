import { Body, Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { DecisionInfoGetVo, DeviceAppGetVo, IDeviceDecisionRo } from '@teable/openapi';
import { deviceDecisionRoSchema } from '@teable/openapi';
import { Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';
import { BaseConfig, IBaseConfig } from '../../configs/base.config';
import type { IClsStore } from '../../types/cls';
import { ZodValidationPipe } from '../../zod.validation.pipe';
import { EnsureLogin } from '../auth/decorators/ensure-login.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { OAuthClientGuard } from './guard/oauth2-client.guard';
import { DeviceAuthorizationError, OAuthDeviceService } from './oauth-device.service';
import { OAuthServerService } from './oauth-server.service';

@Controller('/api/oauth')
export class OAuthServerController {
  constructor(
    private readonly oauthServerService: OAuthServerService,
    private readonly oauthDeviceService: OAuthDeviceService,
    private readonly cls: ClsService<IClsStore>,
    @BaseConfig() private readonly baseConfig: IBaseConfig
  ) {}

  /**
   * Origin the authorization URL is built from. `PUBLIC_ORIGIN` wins when the
   * deployment declares one; otherwise echo back the origin the client reached
   * us on, which is exactly the endpoint it was configured with.
   */
  private resolveOrigin(req: Request): string {
    const configured = this.baseConfig.publicOrigin;
    if (configured) {
      return configured.replace(/\/$/, '');
    }
    const forwardedProto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0];
    const host = (req.headers['x-forwarded-host'] as string | undefined) ?? req.headers.host;
    return `${forwardedProto ?? req.protocol}://${host}`;
  }

  // NOTE: plain @Res() (no passthrough) on purpose. oauth2orize completes the
  // response itself on success paths; with passthrough Nest would send a
  // second reply once the handler settles and crash with ERR_HTTP_HEADERS_SENT.
  // Error paths still reach the global exception filter, which writes the
  // response only when headers have not been sent.
  @EnsureLogin()
  @Get('authorize')
  async authorize(@Res() res: Response, @Req() req: Request) {
    await this.oauthServerService.authorize(req, res);
  }

  @Post('access_token')
  @UseGuards(OAuthClientGuard)
  @Public()
  async accessToken(@Res() res: Response, @Req() req: Request) {
    await this.oauthServerService.token(req, res);
  }

  @EnsureLogin()
  @Post('decision')
  async decision(@Res() res: Response, @Req() req: Request) {
    return this.oauthServerService.decision(req, res);
  }

  /** Device grant, step 1: the client asks for a pair of codes (RFC 8628 §3.1). */
  @Post('device/code')
  @Public()
  async deviceCode(@Req() req: Request, @Res() res: Response) {
    const body = (req.body ?? {}) as Record<string, string>;
    const scope = body.scope?.trim();
    // snake_case: this is the wire format RFC 8628 defines, not our own API.
    /* eslint-disable @typescript-eslint/naming-convention */
    try {
      // Guarded here rather than left to Prisma: findUnique on an undefined
      // unique key throws a validation error, which would surface as a 500.
      if (!body.client_id) {
        throw new DeviceAuthorizationError('invalid_request', 'client_id is required');
      }
      const result = await this.oauthDeviceService.requestDeviceCode({
        clientId: body.client_id,
        scopes: scope ? scope.split(/[\s,]+/).filter(Boolean) : undefined,
        origin: this.resolveOrigin(req),
        ip: req.ip ?? 'unknown',
      });
      // Explicit 200: RFC 8628 §3.2 mandates it, and Nest pre-sets 201 on
      // POST routes even in library mode, which res.json() would inherit.
      res.status(200).json({
        device_code: result.deviceCode,
        user_code: result.userCode,
        verification_uri: result.verificationUri,
        expires_in: result.expiresIn,
        interval: result.interval,
      });
    } catch (error) {
      // RFC 8628 §3.2: failures here are RFC 6749 §5.2 error objects, not this
      // deployment's exception shape. Anything else (rate limit 429, 500s)
      // falls through to the global exception filter.
      if (error instanceof DeviceAuthorizationError) {
        res.status(400).json({ error: error.rfcError, error_description: error.message });
        return;
      }
      throw error;
    }
    /* eslint-enable @typescript-eslint/naming-convention */
  }

  /** What the approval page shows for a user code the person just typed. */
  @EnsureLogin()
  @Get('device/:userCode')
  async deviceApp(@Param('userCode') userCode: string): Promise<DeviceAppGetVo> {
    return this.oauthDeviceService.getDeviceApp(userCode);
  }

  @EnsureLogin()
  @Post('device/decision')
  async deviceDecision(
    @Body(new ZodValidationPipe(deviceDecisionRoSchema)) body: IDeviceDecisionRo
  ): Promise<void> {
    const user = this.cls.get('user');
    await this.oauthServerService.decideDevice({
      userCode: body.userCode,
      approve: body.approve,
      user: { id: user.id, name: user.name, email: user.email },
    });
  }

  @Get('decision/:transactionId')
  async transaction(
    @Req() req: Request,
    @Param('transactionId') transactionId: string
  ): Promise<DecisionInfoGetVo> {
    return this.oauthServerService.getDecisionInfo(req, transactionId);
  }
}
