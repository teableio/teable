import { Injectable } from '@nestjs/common';
import type { ILocalization, NotificationSeverityEnum } from '@teable/core';
import { CacheService } from '../../cache/cache.service';
import type { ICacheStore } from '../../cache/types';
import type { I18nPath } from '../../types/i18n.generated';
import { second } from '../../utils/second';
import { isFailureStreakSummary, shouldSendFailureNotification } from './failure-alert-backoff';
import { NotificationService } from './notification.service';

type IFailureStreakKey =
  | `automation:fail-notify-count:${string}`
  | `routine:fail-notify-count:${string}`;

const FAILURE_STREAK_TTL_SECONDS = second('7d');

export interface IFailureAlert {
  toUserId: string | string[];
  /** Namespace of the resource's alert templates, e.g. `common.email.templates.notify.automation`. */
  i18nPrefix: string;
  /** Template under the prefix: `failed`, `insufficientCredit`, ... */
  kind: string;
  name: string;
  failCount: number;
  resourcePath: string;
  /** Per-run deep link; dropped once the alert summarises a streak. */
  runPath?: string;
  severity: NotificationSeverityEnum;
  /** Past the per-run limit the alert switches to the `failedSummary` template. Off for state-change alerts. */
  summarizeStreak?: boolean;
}

/** Failure alerts for a resource that runs repeatedly (automation, routine): 7-day streak counter, backoff, summary wording. */
@Injectable()
export class FailureAlertService {
  constructor(
    private readonly cacheService: CacheService<ICacheStore>,
    private readonly notificationService: NotificationService
  ) {}

  async recordFailure(
    key: IFailureStreakKey
  ): Promise<{ failCount: number; shouldNotify: boolean }> {
    const failCount = ((await this.cacheService.get(key)) ?? 0) + 1;
    await this.cacheService.setDetail(key, failCount, FAILURE_STREAK_TTL_SECONDS);
    return { failCount, shouldNotify: shouldSendFailureNotification(failCount) };
  }

  async resetStreak(key: IFailureStreakKey): Promise<void> {
    await this.cacheService.del(key);
  }

  async send(alert: IFailureAlert): Promise<{ sentCount: number }> {
    const { toUserId, i18nPrefix, kind, name, failCount, resourcePath, runPath, severity } = alert;
    const useSummary = (alert.summarizeStreak ?? true) && isFailureStreakSummary(failCount);
    const keyPrefix = `${i18nPrefix}.${useSummary ? 'failedSummary' : kind}`;
    const context = { name, failCount: String(failCount) };
    const title: ILocalization<I18nPath> = { i18nKey: `${keyPrefix}.title` as I18nPath, context };
    const message: ILocalization<I18nPath> = {
      i18nKey: `${keyPrefix}.message` as I18nPath,
      context,
    };
    return this.notificationService.sendCommonNotify({
      path: useSummary || !runPath ? resourcePath : runPath,
      toUserId,
      message: title,
      severity,
      emailConfig: { title, message },
    });
  }
}
