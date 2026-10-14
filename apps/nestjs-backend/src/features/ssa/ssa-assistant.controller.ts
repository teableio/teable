/* eslint-disable @typescript-eslint/naming-convention */
import { Body, Controller, Get, Logger, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { SsaConfig } from '../../configs/ssa.config';
import type { ISsaConfig } from '../../configs/ssa.config';
import { safeFetch } from '../../utils/ssrf-http';

/**
 * SSA fork: same-origin proxy for the assistant service (`ssa/services/ai`).
 *
 * Not `@Public()` — the global user auth guard protects it, so only signed-in
 * users reach the model. The LLM key and the internal shared token stay
 * server-side; the service's SSE stream is piped straight through.
 * See docs/ssa/ARCHITECTURE.md §4.
 */
@Controller('api/ssa/assistant')
export class SsaAssistantController {
  private readonly logger = new Logger(SsaAssistantController.name);

  constructor(@SsaConfig() private readonly ssaConfig: ISsaConfig) {}

  private get enabled(): boolean {
    return this.ssaConfig.assistant.enabled && Boolean(this.ssaConfig.assistant.serviceUrl);
  }

  @Get('config')
  config(): { enabled: boolean } {
    return { enabled: this.enabled };
  }

  @Post('chat')
  async chat(
    @Body() body: unknown,
    @Req() request: Request,
    @Res() reply: Response
  ): Promise<void> {
    const { serviceUrl } = this.ssaConfig.assistant;
    const internalToken = this.ssaConfig.internalToken;

    if (!this.enabled || !internalToken) {
      reply.status(503).json({ message: 'assistant is not configured on this deployment' });
      return;
    }

    const controller = new AbortController();
    request.on('close', () => controller.abort());

    let upstream: Awaited<ReturnType<typeof safeFetch>>;
    try {
      // The service URL is operator-configured, hence `allowPrivateNetwork`;
      // cloud-metadata addresses stay blocked.
      upstream = await safeFetch(
        `${serviceUrl.replace(/\/$/, '')}/chat`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-ssa-token': internalToken,
          },
          body: JSON.stringify(body ?? {}),
          signal: controller.signal,
        },
        { allowPrivateNetwork: true }
      );
    } catch (error) {
      this.logger.warn(
        `assistant service unreachable: ${error instanceof Error ? error.message : String(error)}`
      );
      reply.status(502).json({ message: 'assistant service is unreachable' });
      return;
    }

    reply.status(upstream.status);
    reply.setHeader(
      'content-type',
      upstream.headers.get('content-type') ?? 'application/json; charset=utf-8'
    );
    reply.setHeader('cache-control', 'no-cache, no-transform');

    if (!upstream.body) {
      reply.end();
      return;
    }

    upstream.body.pipe(reply);
  }
}
