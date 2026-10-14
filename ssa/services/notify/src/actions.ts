import type { IConfig } from './config.js';
import { formatCellValue } from './digest.js';
import type { ISsaRecordEvent } from './events.js';
import type { ILogger } from './logger.js';
import type { IMailer } from './mail.js';
import { CooldownTracker, renderTemplate, ruleMatches, ruleOperationKey } from './rules.js';
import type { IRule } from './rules.js';
import type { ITeableClient } from './teable.js';

export interface IActionContext {
  config: IConfig;
  teable: ITeableClient;
  mailer: IMailer;
  logger: ILogger;
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const buildRuleSubject = (rule: IRule, event: ISsaRecordEvent): string => {
  const values = {
    rule: rule.name,
    event: event.event,
    tableId: event.tableId,
    recordCount: event.recordCount,
  };
  return rule.subject
    ? renderTemplate(rule.subject, values)
    : `[SSA] ${rule.name} — ${event.recordCount} record(s) ${event.event.replace('record.', '')}`;
};

export const renderRuleEmail = (
  rule: IRule,
  event: ISsaRecordEvent
): { html: string; text: string } => {
  const sample = (event.records ?? []).slice(0, 10);
  const rows = sample.map((record) => {
    const fields = Object.entries(record.fields ?? {})
      .slice(0, 6)
      .map(([name, value]) => `${name}: ${formatCellValue(value)}`)
      .join(' | ');
    return { id: record.id, fields };
  });

  const textLines = [
    `Rule: ${rule.name}`,
    `Event: ${event.event} (${event.recordCount} record(s))`,
    `Table: ${event.tableId}${event.baseId ? ` · Base: ${event.baseId}` : ''}`,
    event.user?.name ? `By: ${event.user.name}` : undefined,
    `At: ${event.timestamp}`,
    '',
    ...rows.map((row, index) => `${index + 1}. ${row.fields}`),
    event.truncated ? '(payload truncated — open the app for the full list)' : '',
    `App: ${''}`,
  ].filter((line): line is string => line !== undefined);

  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;">
    <h2 style="font-size:16px;margin:0 0 6px;">${escapeHtml(rule.name)}</h2>
    <p style="margin:0 0 12px;color:#555;">${escapeHtml(event.event)} · ${event.recordCount} record(s)${
      event.baseId ? ` · base ${escapeHtml(event.baseId)}` : ''
    }${event.user?.name ? ` · by ${escapeHtml(event.user.name)}` : ''}</p>
    ${
      rows.length
        ? `<table style="border-collapse:collapse;font-size:13px;">${rows
            .map(
              (row, index) =>
                `<tr style="vertical-align:top;${
                  index % 2 ? 'background:#fafafa;' : ''
                }"><td style="padding:6px 8px;color:#999;">${index + 1}</td><td style="padding:6px 8px;">${escapeHtml(
                  row.fields
                )}</td></tr>`
            )
            .join('')}</table>`
        : ''
    }
    ${event.truncated ? '<p style="color:#777;font-size:12px;">Payload truncated.</p>' : ''}
  </div>`;

  return { html, text: textLines.join('\n') };
};

export const executeRuleActions = async (
  rule: IRule,
  event: ISsaRecordEvent,
  ctx: IActionContext
): Promise<void> => {
  const { config, mailer, teable, logger } = ctx;

  if (rule.email?.length) {
    const { html, text } = renderRuleEmail(rule, event);
    await mailer.send({
      to: rule.email,
      subject: buildRuleSubject(rule, event),
      html,
      text,
    });
  }

  if (rule.inApp && (rule.inApp.toUserId?.length || rule.inApp.toEmail?.length)) {
    try {
      await teable.notifyInApp({
        message: `${rule.name}: ${event.recordCount} ${event.event.replace('record.', '')} record(s)`,
        severity: rule.inApp.severity,
        path: event.baseId ? `/base/${event.baseId}` : undefined,
        toUserId: rule.inApp.toUserId,
        toEmail: rule.inApp.toEmail,
      });
    } catch (error) {
      logger.warn('in-app notification failed', {
        rule: rule.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (!rule.email?.length && !rule.inApp) {
    logger.warn('rule has no actions configured', { rule: rule.name });
  }

  // `config` is currently unused here but kept in the context for future
  // action types (Slack/webhook) that need global settings.
  void config;
};

const cooldowns = new CooldownTracker();

/** Evaluate every rule against an event and run the matching actions. */
export const processEvent = async (
  event: ISsaRecordEvent,
  ctx: IActionContext
): Promise<string[]> => {
  const fired: string[] = [];

  for (const rule of ctx.config.rules) {
    if (!ruleMatches(rule, event)) {
      continue;
    }
    const key = ruleOperationKey(rule, event);
    if (!cooldowns.shouldFire(key, rule.cooldownSeconds)) {
      ctx.logger.debug('rule suppressed by cooldown', { rule: rule.name, key });
      continue;
    }
    try {
      await executeRuleActions(rule, event, ctx);
      fired.push(rule.name);
    } catch (error) {
      ctx.logger.error('rule action failed', {
        rule: rule.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return fired;
};
