import { describe, expect, it, vi } from 'vitest';
import type { IConfig } from './config.js';
import { formatCellValue, renderDigestHtml, renderDigestText, runDigest } from './digest.js';
import type { IDigestSectionData } from './digest.js';
import { createLogger } from './logger.js';
import type { IMailer } from './mail.js';
import type { ITeableClient } from './teable.js';

const logger = createLogger('error', 'test');

const config = (overrides: Partial<IConfig['env']> = {}): IConfig => ({
  env: {
    SSA_PORT: 4600,
    SSA_BIND: '127.0.0.1',
    SSA_LOG_LEVEL: 'error',
    SSA_INTERNAL_TOKEN: 'token',
    SSA_EVENTS_WEBHOOK_SECRET: 'secret',
    SSA_TEABLE_BASE_URL: 'http://localhost:3000',
    SSA_TEABLE_API_TOKEN: 'pat',
    GMAIL_USER: 'bot@example.com',
    GMAIL_APP_PASSWORD: 'app-password',
    GMAIL_SENDER_NAME: 'SSA',
    SSA_DIGEST_CRON: '0 8 * * *',
    SSA_DIGEST_TZ: 'Asia/Kuala_Lumpur',
    SSA_DIGEST_RECIPIENTS: ['ops@example.com'],
    SSA_DRY_RUN: false,
    SSA_RULES_FILE: 'notify.rules.json',
    SSA_DIGEST_FILE: 'notify.digest.json',
    ...overrides,
  },
  rules: [],
  digest: {
    subject: 'SSA digest — {{date}} ({{count}} records)',
    sections: [
      { name: 'Open tasks', tableId: 'tbl1', take: 10, columns: ['Task', 'Status'] },
      { name: 'Leads', tableId: 'tbl2', take: 5, recipients: ['sales@example.com'] },
    ],
  },
});

describe('formatCellValue', () => {
  it('renders primitives, arrays and objects', () => {
    expect(formatCellValue('x')).toBe('x');
    expect(formatCellValue(null)).toBe('');
    expect(formatCellValue(['a', 'b'])).toBe('a, b');
    expect(formatCellValue({ a: 1 })).toBe('{"a":1}');
  });
});

describe('digest rendering', () => {
  const sections: IDigestSectionData[] = [
    {
      section: { name: 'Open tasks', tableId: 'tbl1', take: 10, columns: ['Task', 'Status'] },
      records: [
        { id: 'rec1', fields: { Task: '<Ship it>', Status: 'Doing' } },
        { id: 'rec2', fields: { Task: 'Call back', Status: 'Todo' } },
      ],
    },
    {
      section: { name: 'Leads', tableId: 'tbl2', take: 5 },
      records: [],
      error: 'HTTP 500',
    },
    {
      section: { name: 'Inbox', tableId: 'tbl3', take: 5 },
      records: [],
    },
  ];

  it('renders html with escaped values and error sections', () => {
    const html = renderDigestHtml({ sections, dateLabel: 'Monday', sourceUrl: 'http://app' });

    expect(html).toContain('Open tasks');
    expect(html).toContain('2');
    expect(html).toContain('&lt;Ship it&gt;');
    expect(html).not.toContain('<Ship it>');
    expect(html).toContain('Failed to load: HTTP 500');
    expect(html).toContain('Nothing here');
  });

  it('renders text rows', () => {
    const text = renderDigestText({ sections, dateLabel: 'Monday', sourceUrl: 'http://app' });

    expect(text).toContain('SSA daily digest — Monday');
    expect(text).toContain('1. Task: <Ship it> | Status: Doing');
    expect(text).toContain('failed to load: HTTP 500');
  });
});

describe('runDigest', () => {
  it('collects sections, unions recipients and sends one email', async () => {
    const seen: { to: string[]; subject: string; html: string }[] = [];
    const mailer: IMailer = {
      isConfigured: () => true,
      send: vi.fn(async (mail) => {
        seen.push({ to: mail.to, subject: mail.subject, html: mail.html });
      }),
    };
    const teable: ITeableClient = {
      listRecords: vi.fn(async (tableId: string) => {
        if (tableId === 'tbl1') {
          return [{ id: 'rec1', fields: { Task: 'A' } }];
        }
        throw new Error('boom');
      }),
      notifyInApp: vi.fn(),
    };

    const result = await runDigest({
      config: config(),
      teable,
      mailer,
      logger,
      now: new Date('2026-10-14T00:00:00Z'),
    });

    expect(teable.listRecords).toHaveBeenCalledTimes(2);
    expect(seen).toHaveLength(1);
    expect(seen[0].to).toEqual(['ops@example.com', 'sales@example.com']);
    expect(result.totalRecords).toBe(1);
    expect(seen[0].subject).toMatch(/^SSA digest — .*\(1 records\)$/);
  });
});
