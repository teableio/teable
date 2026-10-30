import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HttpError, HttpErrorCode } from '@teable/core';
import ShareDB from 'sharedb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authMiddleware } from './auth.middleware';
import { ShareDbAdapter } from './share-db.adapter';

interface IWireReply {
  a: string;
  error?: { code: string; message: string };
}

const fixtures: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of fixtures.splice(0)) await dispose();
});

const localesDir = join(__dirname, '../../../../packages/common-i18n/src/locales');

// Mirrors nestjs-i18n's lookup of `sdk.<key>` with {{arg}} interpolation over the real locale files.
const i18n = {
  getSupportedLanguages: () => ['en', 'zh', 'ja', 'fr', 'de'],
  t: (key: string, { lang, args }: { lang: string; args?: Record<string, string> }) => {
    const [ns, ...path] = key.split('.');
    const dict = JSON.parse(readFileSync(join(localesDir, lang, `${ns}.json`), 'utf8'));
    const template = path.reduce((node, part) => node?.[part], dict) as string;
    return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name) => args?.[name] ?? '');
  },
};

interface IRequesterLocale {
  /** NEXT_LOCALE cookie */
  cookieLang?: string;
  /** `lang` on the socket URL, the page's own language as sent by the SDK */
  urlLang?: string;
  acceptLanguage?: string;
}

async function queryWithError(error: HttpError, locale: IRequesterLocale = {}) {
  const { cookieLang, urlLang, acceptLanguage } = locale;
  const cls = {
    get: () => ({}),
    runWith: (_store: unknown, run: () => Promise<void>) => run(),
  };
  const records = {
    getDocIdsByQuery: async () => {
      throw error;
    },
  };
  const adapter = new ShareDbAdapter(
    cls as never,
    {} as never,
    records as never,
    {} as never,
    {} as never,
    {} as never,
    undefined,
    i18n as never
  );
  const backend = new ShareDB({ db: adapter });
  authMiddleware(backend);
  const replies: IWireReply[] = [];
  // Capture the installed server's actual reply after getReplyErrorObject, not
  // the adapter callback. JSON round-trip matches the WebSocket payload boundary.
  backend.on('send', (_agent, message) => {
    if (message.a === 'qf') replies.push(JSON.parse(JSON.stringify(message)));
  });
  const connection = backend.connect(undefined, {
    headers: {
      cookie: `session=error-transport${cookieLang ? `; NEXT_LOCALE=${cookieLang}` : ''}`,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      ...(acceptLanguage ? { 'accept-language': acceptLanguage } : {}),
    },
    url: urlLang ? `/socket?lang=${urlLang}` : '/socket',
  });
  fixtures.push(async () => {
    connection.close();
    await new Promise<void>((resolve, reject) => {
      backend.close((closeError) => (closeError ? reject(closeError) : resolve()));
    });
  });
  await vi.waitFor(() => expect(connection.state).toBe('connected'));
  const clientError = await new Promise<Error | null | undefined>((resolve) => {
    connection.createFetchQuery('rec_tblPending', {}, {}, (queryError) => resolve(queryError));
  });
  return { replies, clientError };
}

describe('ShareDbAdapter error transport (installed server and client)', () => {
  it('preserves the pending identity through normalization and socket serialization', async () => {
    const { replies, clientError } = await queryWithError(
      new HttpError(
        {
          message: 'Physical table is not ready',
          code: HttpErrorCode.DATABASE_CONNECTION_UNAVAILABLE,
          data: {
            domainCode: 'table.provision_pending',
            details: { tableId: 'tblPending' },
          },
        },
        503
      )
    );

    expect(replies).toEqual([
      expect.objectContaining({
        a: 'qf',
        error: {
          code: 'table.provision_pending',
          message: 'Physical table is not ready',
        },
      }),
    ]);
    expect(clientError).toMatchObject({
      code: 'table.provision_pending',
      message: 'Physical table is not ready',
    });
  });

  it('does not classify an ordinary database outage as pending from its message', async () => {
    const { replies, clientError } = await queryWithError(
      new HttpError(
        {
          message: 'Physical table is not ready',
          code: HttpErrorCode.DATABASE_CONNECTION_UNAVAILABLE,
          data: { domainCode: 'database.connection_unavailable' },
        },
        503
      )
    );

    expect(replies).toEqual([
      expect.objectContaining({
        error: {
          code: HttpErrorCode.DATABASE_CONNECTION_UNAVAILABLE,
          message: 'Physical table is not ready',
        },
      }),
    ]);
    expect(clientError).toMatchObject({
      code: HttpErrorCode.DATABASE_CONNECTION_UNAVAILABLE,
    });
  });

  const incompatibleError = () =>
    new HttpError(
      {
        message: "Field '阈值' is not compatible with '数量' for filter comparisons",
        code: HttpErrorCode.VALIDATION_ERROR,
        data: {
          localization: {
            i18nKey: 'httpErrors.filter.fieldReferenceIncompatible',
            context: { reference: '阈值', source: '数量' },
          },
        },
      },
      400
    );
  const copy = {
    en: 'Field 阈值 has an incompatible type and cannot be compared with 数量',
    zh: '字段 阈值 与 数量 类型不兼容，无法比较',
    ja: 'フィールド 阈值 は 数量 と型が互換でないため比較できません',
  };

  it.each<[string, IRequesterLocale, string]>([
    ['the NEXT_LOCALE cookie (en)', { cookieLang: 'en' }, copy.en],
    ['the NEXT_LOCALE cookie (zh)', { cookieLang: 'zh' }, copy.zh],
    ['the NEXT_LOCALE cookie (ja)', { cookieLang: 'ja' }, copy.ja],
    [
      'Accept-Language without a cookie (zh)',
      { acceptLanguage: 'zh-CN,zh;q=0.9,en;q=0.8' },
      copy.zh,
    ],
    ['Accept-Language without a cookie (ja)', { acceptLanguage: 'en;q=0.5,ja' }, copy.ja],
    [
      'the page language on the socket URL over the cookie',
      { urlLang: 'ja', cookieLang: 'zh' },
      copy.ja,
    ],
    [
      'the page language on the socket URL without a cookie',
      { urlLang: 'zh', acceptLanguage: 'ja' },
      copy.zh,
    ],
    ['English when nothing matches', { acceptLanguage: 'ko-KR' }, copy.en],
  ])(
    'localizes the field-reference incompatibility message from %s (T7960)',
    async (_case, locale, message) => {
      const { replies, clientError } = await queryWithError(incompatibleError(), locale);

      expect(replies).toEqual([
        expect.objectContaining({
          a: 'qf',
          error: { code: HttpErrorCode.VALIDATION_ERROR, message },
        }),
      ]);
      expect(clientError).toMatchObject({ code: HttpErrorCode.VALIDATION_ERROR, message });
    }
  );
});
