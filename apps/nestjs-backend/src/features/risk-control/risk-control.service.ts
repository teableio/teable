import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { IRiskControlConfig, RiskControlConfig } from '../../configs/risk-control.config';

export type IRiskCheckType = 'signup' | 'invitation';

interface IRiskCheckResponse {
  verdict: 'allow' | 'deny';
  reasons: string[];
}

/**
 * Client of the external risk control service (a Cloudflare Worker keeping a
 * disposable-email-domain blocklist). Disabled unless RISK_SERVICE_URL is set.
 *
 * All failures (timeout, 5xx, bad config) fail open: risk control must never
 * take sign-up or invitation down with it.
 */
@Injectable()
export class RiskControlService {
  private readonly logger = new Logger(RiskControlService.name);

  constructor(@RiskControlConfig() private readonly config: IRiskControlConfig) {}

  get enabled(): boolean {
    return Boolean(this.config.url && this.config.token);
  }

  /**
   * Whether the email is denied by the risk control service.
   * Returns false when the service is disabled or unreachable (fail open).
   */
  async isEmailDenied(type: IRiskCheckType, email: string): Promise<boolean> {
    if (!this.enabled) {
      return false;
    }
    try {
      const { data } = await axios.post<IRiskCheckResponse>(
        `${this.config.url}/v1/check`,
        { type, email },
        {
          timeout: this.config.timeout,
          headers: { Authorization: `Bearer ${this.config.token}` },
        }
      );
      if (data.verdict === 'deny') {
        this.logger.log(
          `[risk-control] denied type=${type} email=${email} reasons=${data.reasons.join('; ')}`
        );
        return true;
      }
      return false;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[risk-control] check failed (fail open): ${message}`);
      return false;
    }
  }

  /**
   * Check multiple emails and return the denied subset.
   * A single failed request only fails open for that email.
   */
  async filterDeniedEmails(type: IRiskCheckType, emails: string[]): Promise<Set<string>> {
    if (!this.enabled || !emails.length) {
      return new Set();
    }
    const results = await Promise.all(
      emails.map(async (email) => ((await this.isEmailDenied(type, email)) ? email : null))
    );
    return new Set(results.filter((email): email is string => email !== null));
  }
}
