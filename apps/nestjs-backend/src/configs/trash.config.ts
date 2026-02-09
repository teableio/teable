/* eslint-disable sonarjs/cognitive-complexity */
/* eslint-disable @typescript-eslint/naming-convention */

import { Inject } from '@nestjs/common';
import { registerAs } from '@nestjs/config';
import ms from 'ms';

export const trashConfig = registerAs('trash', () => ({
  /**
   * Retention period for trashed resources before permanent deletion.
   * Supports ms library format: '30d', '7d', '24h', etc.
   * Set to '0' to disable automatic cleanup.
   * Default: 30 days
   */
  retention: ms((process.env.TRASH_RETENTION as string) ?? '30d'),
  /**
   * Interval between trash cleanup scans.
   * Supports ms library format: '1h', '30m', '2d', etc.
   * Default: 1 hour
   */
  scanInterval: ms((process.env.TRASH_SCAN_INTERVAL as string) ?? '1h'),
}));

export const TrashConfig = () => Inject(trashConfig.KEY);

export type ITrashConfig = ReturnType<typeof trashConfig>;
