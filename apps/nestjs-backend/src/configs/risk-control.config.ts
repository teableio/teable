/* eslint-disable @typescript-eslint/naming-convention */
import { Inject } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { registerAs } from '@nestjs/config';

export const riskControlConfig = registerAs('riskControl', () => ({
  /**
   * Base url of the external risk control service (e.g. a Cloudflare Worker).
   * The feature is disabled when unset.
   */
  url: process.env.RISK_SERVICE_URL?.replace(/\/+$/, ''),
  token: process.env.RISK_SERVICE_TOKEN,
  timeout: Number(process.env.RISK_SERVICE_TIMEOUT ?? 3000),
}));

export const RiskControlConfig = () => Inject(riskControlConfig.KEY);

export type IRiskControlConfig = ConfigType<typeof riskControlConfig>;
