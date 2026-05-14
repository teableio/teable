ALTER TABLE "notification" ADD COLUMN "severity" TEXT NOT NULL DEFAULT 'info';

UPDATE "notification"
SET "severity" = CASE
  WHEN substring("message_i18n" from '"i18nKey":"([^"]*)"') = ANY (ARRAY[
    'email.templates.notify.task.ai.cancelled.creditExhausted',
    'email.templates.notify.task.ai.cancelled.authFailed',
    'email.templates.notify.task.ai.cancelled.rateLimit',
    'email.templates.notify.task.ai.cancelled.serviceUnavailable',
    'email.templates.notify.automation.insufficientCredit.title',
    'email.templates.notify.automation.runQuotaExceeded.title',
    'email.templates.notify.billing.automationRun.gracePeriod.title',
    'email.templates.notify.billing.credit.anomaly.dailySpike.title',
    'email.templates.notify.billing.automationRun.anomaly.dailySpike.title',
    'email.templates.notify.billing.automationRun.anomaly.burst.title'
  ]) THEN 'critical'
  WHEN substring("message_i18n" from '"i18nKey":"([^"]*)"') = ANY (ARRAY[
    'email.templates.notify.task.ai.failed.message',
    'email.templates.notify.automation.failed.title',
    'email.templates.notify.automation.failedSummary.title',
    'email.templates.notify.exportBase.failed.message',
    'email.templates.notify.billing.credit.warning80.title',
    'email.templates.notify.billing.automationRun.warning80.title',
    'email.templates.notify.billing.credit.warning90.title',
    'email.templates.notify.billing.automationRun.warning90.title'
  ]) THEN 'warning'
  ELSE 'info'
END
WHERE "message_i18n" IS NOT NULL;
