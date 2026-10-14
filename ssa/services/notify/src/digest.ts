import type { IConfig, IDigestSection } from './config.js';
import type { ILogger } from './logger.js';
import type { IMailer } from './mail.js';
import { renderTemplate } from './rules.js';
import type { ITeableClient, ITeableRecord } from './teable.js';

export interface IDigestSectionData {
  section: IDigestSection;
  records: ITeableRecord[];
  error?: string;
}

export interface IDigestRenderInput {
  sections: IDigestSectionData[];
  intro?: string;
  dateLabel: string;
  sourceUrl: string;
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const formatCellValue = (value: unknown): string => {
  if (value == null) {
    return '';
  }
  if (Array.isArray(value)) {
    return value.map((item) => formatCellValue(item)).join(', ');
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
};

const recordColumns = (record: ITeableRecord, columns?: string[]): [string, string][] => {
  if (columns?.length) {
    return columns.map((name) => [name, formatCellValue(record.fields?.[name])]);
  }
  const entries = Object.entries(record.fields ?? {});
  return entries.slice(0, 4).map(([name, value]) => [name, formatCellValue(value)]);
};

export const renderDigestHtml = (input: IDigestRenderInput): string => {
  const parts: string[] = [];
  parts.push(
    `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;">
    <h1 style="font-size:20px;margin:0 0 4px;">SSA daily digest</h1>
    <p style="margin:0 0 16px;color:#555;">${escapeHtml(input.dateLabel)}</p>`
  );
  if (input.intro) {
    parts.push(`<p style="margin:0 0 16px;">${escapeHtml(input.intro)}</p>`);
  }

  if (input.sections.length === 0) {
    parts.push(
      `<p style="color:#777;">No digest sections are configured yet — see <code>notify.digest.json</code>.</p>`
    );
  }

  for (const { section, records, error } of input.sections) {
    parts.push(
      `<h2 style="font-size:16px;margin:20px 0 8px;border-bottom:1px solid #e5e5e5;padding-bottom:4px;">
        ${escapeHtml(section.name)} <span style="color:#777;font-weight:400;">(${
          error ? 'error' : `${records.length}`
        })</span>
      </h2>`
    );
    if (error) {
      parts.push(
        `<p style="color:#b91c1c;margin:0 0 8px;">Failed to load: ${escapeHtml(error)}</p>`
      );
      continue;
    }
    if (records.length === 0) {
      parts.push(`<p style="color:#777;margin:0 0 8px;">Nothing here. 🎉</p>`);
      continue;
    }

    parts.push(
      `<table style="border-collapse:collapse;width:100%;font-size:13px;margin:0 0 8px;">`
    );
    records.forEach((record, index) => {
      const columns = recordColumns(record, section.columns);
      parts.push(
        `<tr style="vertical-align:top;${
          index % 2 ? 'background:#fafafa;' : ''
        }"><td style="padding:6px 8px;color:#999;width:28px;">${index + 1}</td>` +
          columns
            .map(
              ([name, value]) =>
                `<td style="padding:6px 8px;"><div style="color:#888;font-size:11px;">${escapeHtml(
                  name
                )}</div><div>${escapeHtml(value)}</div></td>`
            )
            .join('') +
          `</tr>`
      );
    });
    parts.push(`</table>`);
    const more = section.take - records.length;
    if (more <= 0) {
      parts.push(
        `<p style="color:#777;font-size:12px;margin:0 0 8px;">Showing the first ${section.take} records.</p>`
      );
    }
  }

  parts.push(
    `<p style="margin:24px 0 0;color:#999;font-size:12px;">Open the app: <a href="${escapeHtml(
      input.sourceUrl
    )}">${escapeHtml(input.sourceUrl)}</a></p></div>`
  );
  return parts.join('\n');
};

export const renderDigestText = (input: IDigestRenderInput): string => {
  const lines: string[] = [`SSA daily digest — ${input.dateLabel}`, ''];
  if (input.intro) {
    lines.push(input.intro, '');
  }
  if (input.sections.length === 0) {
    lines.push('No digest sections are configured yet.');
  }
  for (const { section, records, error } of input.sections) {
    lines.push(`## ${section.name} (${error ? 'error' : records.length})`);
    if (error) {
      lines.push(`  failed to load: ${error}`, '');
      continue;
    }
    if (records.length === 0) {
      lines.push('  nothing here', '');
      continue;
    }
    records.forEach((record, index) => {
      const columns = recordColumns(record, section.columns)
        .map(([name, value]) => `${name}: ${value}`)
        .join(' | ');
      lines.push(`  ${index + 1}. ${columns}`);
    });
    lines.push('');
  }
  lines.push(`App: ${input.sourceUrl}`);
  return lines.join('\n');
};

export const collectDigestData = async (params: {
  config: IConfig;
  teable: ITeableClient;
  logger: ILogger;
}): Promise<IDigestSectionData[]> => {
  const { config, teable, logger } = params;
  const results: IDigestSectionData[] = [];

  for (const section of config.digest.sections) {
    try {
      const records = await teable.listRecords(section.tableId, {
        viewId: section.viewId,
        take: section.take,
      });
      results.push({ section, records });
      logger.debug('digest section loaded', {
        section: section.name,
        tableId: section.tableId,
        records: records.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('digest section failed', { section: section.name, error: message });
      results.push({ section, records: [], error: message });
    }
  }

  return results;
};

export interface IDigestRunResult {
  recipients: string[];
  totalRecords: number;
  sections: number;
  subject: string;
}

export const runDigest = async (params: {
  config: IConfig;
  teable: ITeableClient;
  mailer: IMailer;
  logger: ILogger;
  now?: Date;
}): Promise<IDigestRunResult> => {
  const { config, teable, mailer, logger } = params;
  const now = params.now ?? new Date();
  const dateLabel = new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'full',
    timeZone: config.env.SSA_DIGEST_TZ,
  }).format(now);

  const sections = await collectDigestData({ config, teable, logger });
  const totalRecords = sections.reduce((sum, section) => sum + section.records.length, 0);

  const recipients = [
    ...new Set([
      ...config.env.SSA_DIGEST_RECIPIENTS,
      ...config.digest.sections.flatMap((section) => section.recipients ?? []),
    ]),
  ];

  const renderInput: IDigestRenderInput = {
    sections,
    intro: config.digest.intro,
    dateLabel,
    sourceUrl: config.env.SSA_TEABLE_BASE_URL,
  };
  const subject = renderTemplate(config.digest.subject, {
    date: dateLabel,
    count: totalRecords,
  });

  await mailer.send({
    to: recipients,
    subject,
    html: renderDigestHtml(renderInput),
    text: renderDigestText(renderInput),
  });

  logger.info('digest completed', { recipients, totalRecords, sections: sections.length });
  return { recipients, totalRecords, sections: sections.length, subject };
};
