/* eslint-disable @typescript-eslint/naming-convention */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface ITurnstileValidationResponse {
  success: boolean;
  'error-codes'?: string[];
  challenge_ts?: string;
  hostname?: string;
  action?: string;
  cdata?: string;
  metadata?: {
    ephemeral_id?: string;
  };
}

interface ITurnstileValidationRequest {
  secret: string;
  response: string;
  remoteip?: string;
  idempotency_key?: string;
}

@Injectable()
export class TurnstileService {
  private readonly logger = new Logger(TurnstileService.name);
  private readonly turnstileSecretKey: string;
  private readonly turnstileSiteKey: string;
  private readonly isEnabled: boolean;

  constructor(private readonly configService: ConfigService) {
    this.turnstileSecretKey = this.configService.get<string>('TURNSTILE_SECRET_KEY') || '';
    this.turnstileSiteKey = this.configService.get<string>('TURNSTILE_SITE_KEY') || '';
    this.isEnabled = Boolean(this.turnstileSiteKey && this.turnstileSecretKey);

    this.logger.log(
      `Turnstile Service Initialization - isEnabled: ${this.isEnabled}, hasSiteKey: ${!!this.turnstileSiteKey}, hasSecretKey: ${!!this.turnstileSecretKey}, siteKeyLength: ${this.turnstileSiteKey?.length}, secretKeyLength: ${this.turnstileSecretKey?.length}`
    );

    if (this.isEnabled) {
      this.logger.log('Turnstile validation is enabled');
    } else {
      this.logger.warn('Turnstile validation is disabled - missing site key or secret key');
    }
  }

  /**
   * Check if Turnstile is enabled based on environment configuration
   */
  isTurnstileEnabled(): boolean {
    return this.isEnabled;
  }

  /**
   * Get the Turnstile site key for client-side rendering
   */
  getTurnstileSiteKey(): string | null {
    return this.isEnabled ? this.turnstileSiteKey : null;
  }

  /**
   * Validate Turnstile token with Cloudflare's siteverify API
   */
  async validateTurnstileToken(
    token: string,
    remoteIp?: string,
    expectedAction?: string,
    expectedHostname?: string
  ): Promise<{ valid: boolean; reason?: string; data?: ITurnstileValidationResponse }> {
    if (!this.isEnabled) {
      this.logger.warn('Turnstile validation attempted but service is not enabled');
      return { valid: false, reason: 'turnstile_disabled' };
    }

    if (!token || typeof token !== 'string') {
      return { valid: false, reason: 'invalid_token_format' };
    }

    if (token.length > 2048) {
      return { valid: false, reason: 'token_too_long' };
    }

    const requestData: ITurnstileValidationRequest = {
      secret: this.turnstileSecretKey,
      response: token,
    };

    if (remoteIp) {
      requestData.remoteip = remoteIp;
    }

    try {
      const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestData),
      });

      if (!response.ok) {
        this.logger.error(`Turnstile API returned ${response.status}: ${response.statusText}`);
        return { valid: false, reason: 'api_error' };
      }

      const result: ITurnstileValidationResponse = await response.json();

      if (!result.success) {
        this.logger.warn('Turnstile validation failed', {
          errorCodes: result['error-codes'],
          token: token.substring(0, 20) + '...',
        });
        return {
          valid: false,
          reason: 'turnstile_failed',
          data: result,
        };
      }

      // Log action and hostname for monitoring (but don't reject)
      if (expectedAction && result.action && result.action !== expectedAction) {
        this.logger.debug('Turnstile action info', {
          expected: expectedAction,
          received: result.action,
        });
      }

      if (expectedHostname && result.hostname && result.hostname !== expectedHostname) {
        this.logger.debug('Turnstile hostname info', {
          expected: expectedHostname,
          received: result.hostname,
        });
      }

      // Check token age (warn if older than 4 minutes)
      if (result.challenge_ts) {
        const challengeTime = new Date(result.challenge_ts);
        const now = new Date();
        const ageMinutes = (now.getTime() - challengeTime.getTime()) / (1000 * 60);

        if (ageMinutes > 4) {
          this.logger.warn(`Turnstile token is ${ageMinutes.toFixed(1)} minutes old`);
        }
      }

      this.logger.debug('Turnstile validation successful', {
        hostname: result.hostname,
        action: result.action,
        challengeTs: result.challenge_ts,
      });

      return { valid: true, data: result };
    } catch (error) {
      this.logger.error('Turnstile validation error', error);
      return { valid: false, reason: 'internal_error' };
    }
  }

  /**
   * Validate Turnstile token with retry logic
   */
  async validateTurnstileTokenWithRetry(
    token: string,
    remoteIp?: string,
    expectedAction?: string,
    expectedHostname?: string,
    maxRetries: number = 3
  ): Promise<{ valid: boolean; reason?: string; data?: ITurnstileValidationResponse }> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const result = await this.validateTurnstileToken(
        token,
        remoteIp,
        expectedAction,
        expectedHostname
      );

      // If validation succeeded or failed for non-retryable reasons, return immediately
      if (result.valid || (result.reason !== 'api_error' && result.reason !== 'internal_error')) {
        return result;
      }

      // If this is the last attempt, return the error
      if (attempt === maxRetries) {
        return result;
      }

      // Wait before retrying (exponential backoff)
      const delay = Math.pow(2, attempt - 1) * 1000;
      await new Promise((resolve) => setTimeout(resolve, delay));

      this.logger.warn(`Turnstile validation attempt ${attempt} failed, retrying in ${delay}ms`);
    }

    return { valid: false, reason: 'max_retries_exceeded' };
  }
}
