import { SettingKey, isMaskedSecret } from '@teable/openapi';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAiConfigValueCodec, mapAiConfigSecrets } from '../../utils/ai-config-encryption';
import { isEncryptedSecretValue } from '../../utils/secret-value-codec';
import { getThirdPartyCredentialCodec } from '../../utils/third-party-credential-encryption';
import type { ISecretSlot } from './secret-binding';
import { unmaskSecrets } from './secret-binding';
import {
  AI_CONFIG_SECRET_SLOTS,
  APP_CONFIG_SECRET_SLOTS,
  IM_CONFIG_SECRET_SLOTS,
  MAIL_TRANSPORT_SECRET_SLOTS,
  assertSettingSecretsReentered,
  decryptSettingSecrets,
  encryptSettingSecrets,
  mapAppConfigSecrets,
  mapImConfigSecrets,
  mapMailTransportConfigSecrets,
  maskSettingSecrets,
  maskSettingsSecrets,
  unmaskSettingSecrets,
} from './setting-secrets';

describe('setting secrets', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const imConfig = { telegram: { botToken: 'tg-token', botUsername: 'teable_bot' } };

  it('stores each secret-bearing setting under its own codec and reads it back', () => {
    vi.stubEnv('BACKEND_THIRD_PARTY_CREDENTIAL_ENCRYPTION_ENABLED', 'true');
    const storedIm = encryptSettingSecrets(SettingKey.IM_CONFIG, imConfig) as typeof imConfig;
    expect(getThirdPartyCredentialCodec().decryptValueStrict(storedIm.telegram.botToken)).toBe(
      'tg-token'
    );
    expect(storedIm.telegram.botUsername).toBe('teable_bot');
    expect(decryptSettingSecrets(SettingKey.IM_CONFIG, storedIm)).toEqual(imConfig);

    const aiConfig = { llmProviders: [{ type: 'openai', name: 'p1', apiKey: 'sk-1' }] };
    const storedAi = encryptSettingSecrets(SettingKey.AI_CONFIG, aiConfig) as typeof aiConfig;
    expect(getAiConfigValueCodec().decryptValueStrict(storedAi.llmProviders[0].apiKey)).toBe(
      'sk-1'
    );
    expect(decryptSettingSecrets(SettingKey.AI_CONFIG, storedAi)).toEqual(aiConfig);
  });

  it('keeps third-party credentials plaintext while the switch is off', () => {
    vi.stubEnv('BACKEND_THIRD_PARTY_CREDENTIAL_ENCRYPTION_ENABLED', '');
    expect(encryptSettingSecrets(SettingKey.IM_CONFIG, imConfig)).toEqual(imConfig);
    // aiConfig does not follow the switch
    const storedAi = encryptSettingSecrets(SettingKey.AI_CONFIG, { aiGatewayApiKey: 'gw' }) as {
      aiGatewayApiKey: string;
    };
    expect(isEncryptedSecretValue(storedAi.aiGatewayApiKey)).toBe(true);
  });

  it('passes a setting without secrets through untouched', () => {
    const value = { enabled: true };
    expect(encryptSettingSecrets(SettingKey.BRAND_NAME, value)).toBe(value);
    expect(decryptSettingSecrets(SettingKey.BRAND_NAME, value)).toBe(value);
  });
});

describe('mapImConfigSecrets', () => {
  const fullConfig = {
    telegram: { botToken: 'tg-token', botUsername: 'teable_bot' },
    feishu: { appId: 'cli_x', appSecret: 'fs-secret', botName: 'Teable' },
    slack: {
      clientId: 'client-id',
      clientSecret: 'client-secret',
      signingSecret: 'signing-secret',
      botName: 'teable',
    },
  };

  it('visits exactly the secret slots and leaves everything else untouched', () => {
    const mapped = mapImConfigSecrets(fullConfig, (value) => `enc(${value})`);

    expect(mapped).toEqual({
      telegram: { botToken: 'enc(tg-token)', botUsername: 'teable_bot' },
      feishu: { appId: 'cli_x', appSecret: 'enc(fs-secret)', botName: 'Teable' },
      slack: {
        clientId: 'client-id',
        clientSecret: 'enc(client-secret)',
        signingSecret: 'enc(signing-secret)',
        botName: 'teable',
      },
    });
    // pure: the input object is never mutated
    expect(fullConfig.telegram.botToken).toBe('tg-token');
  });

  it('tolerates null configs, null platforms and empty secrets', () => {
    expect(mapImConfigSecrets(null, (v) => `x${v}`)).toBeNull();
    expect(
      mapImConfigSecrets({ telegram: null, feishu: { appId: 'a', appSecret: '' } }, (v) => `x${v}`)
    ).toEqual({ telegram: null, feishu: { appId: 'a', appSecret: '' } });
  });

  it('decrypts a mixed plaintext / ciphertext config', () => {
    const codec = getThirdPartyCredentialCodec();
    const stored = {
      ...fullConfig,
      telegram: { ...fullConfig.telegram, botToken: codec.encryptValue('tg-token') },
      slack: { ...fullConfig.slack, signingSecret: codec.encryptValue('signing-secret') },
    };

    expect(decryptSettingSecrets(SettingKey.IM_CONFIG, stored)).toEqual(fullConfig);
  });
});

describe('mail transport / appConfig secret slots', () => {
  const smtp = { sender: 's@x', host: 'smtp.x', port: 465, auth: { user: 'u', pass: 'pw' } };

  it('maps only the SMTP password of a mail transport config', () => {
    expect(mapMailTransportConfigSecrets(smtp, (v) => `enc(${v})`)).toEqual({
      ...smtp,
      auth: { user: 'u', pass: 'enc(pw)' },
    });
  });

  it('maps the Vercel token, the Google and OIDC client secrets and the email-OTP SMTP password', () => {
    const appConfig = {
      vercelToken: 'vt',
      customDomain: 'apps.x',
      deployProvider: 'vercel',
      appAuth: {
        google: { clientId: 'g', clientSecret: 'gs' },
        oidc: { tokenUrl: 'https://idp.x/token', clientId: 'o', clientSecret: 'os' },
        emailOtp: { smtp },
      },
    };
    expect(mapAppConfigSecrets(appConfig, (v) => `enc(${v})`)).toEqual({
      ...appConfig,
      vercelToken: 'enc(vt)',
      appAuth: {
        google: { clientId: 'g', clientSecret: 'enc(gs)' },
        oidc: { tokenUrl: 'https://idp.x/token', clientId: 'o', clientSecret: 'enc(os)' },
        emailOtp: { smtp: { ...smtp, auth: { user: 'u', pass: 'enc(pw)' } } },
      },
    });
  });

  describe('admin API masks', () => {
    const aiConfig = {
      llmProviders: [
        { type: 'openai', name: 'teable', apiKey: 'sk-one', models: 'gpt-4o' },
        { type: 'anthropic', name: 'teable', apiKey: 'sk-two', models: 'claude' },
      ],
      aiGatewayApiKey: 'vck-gateway',
      chatModel: { lg: 'openai@gpt-4o@teable' },
    };

    it('masks every secret slot of each secret-bearing setting and nothing else', () => {
      const settings = {
        brandName: 'Teable',
        aiConfig,
        appConfig: { vercelToken: 'vercel-token', customDomain: 'apps.example.com' },
        notifyMailTransportConfig: { host: 'smtp.example.com', auth: { user: 'u', pass: 'pw' } },
        imConfig: { telegram: { botToken: 'tg-token', botUsername: 'teable_bot' } },
      };

      const masked = maskSettingsSecrets(settings);

      const json = JSON.stringify(masked);
      for (const secret of ['sk-one', 'sk-two', 'vck-gateway', 'vercel-token', 'pw', 'tg-token']) {
        expect(json).not.toContain(`"${secret}"`);
      }
      expect(isMaskedSecret(masked.aiConfig.llmProviders[0].apiKey)).toBe(true);
      expect(masked.aiConfig.llmProviders[0].apiKey).not.toBe(
        masked.aiConfig.llmProviders[1].apiKey
      );
      expect(masked).toMatchObject({
        brandName: 'Teable',
        aiConfig: { chatModel: aiConfig.chatModel },
        appConfig: { customDomain: 'apps.example.com' },
        notifyMailTransportConfig: { host: 'smtp.example.com', auth: { user: 'u' } },
        imConfig: { telegram: { botUsername: 'teable_bot' } },
      });
      expect(settings.appConfig.vercelToken).toBe('vercel-token');
    });

    it('resolves masks written back to the secret each one stands for, in any order', () => {
      const masked = maskSettingSecrets(SettingKey.AI_CONFIG, aiConfig);
      const [first, second] = masked.llmProviders;
      const incoming = {
        ...masked,
        llmProviders: [second, { ...first, apiKey: 'sk-new' }, { ...first, models: 'gpt-4.1' }],
      };

      const resolved = unmaskSettingSecrets(SettingKey.AI_CONFIG, incoming, aiConfig);

      expect(resolved.llmProviders.map((provider) => provider.apiKey)).toEqual([
        'sk-two',
        'sk-new',
        'sk-one',
      ]);
      expect(resolved.aiGatewayApiKey).toBe('vck-gateway');
    });

    it('resolves a test call mask only at the address the secret is saved for', () => {
      const appConfig = { vercelToken: 'vercel-token' };
      const masked = maskSettingSecrets(SettingKey.APP_CONFIG, appConfig);
      const test = (vercelApiBaseUrl?: string) =>
        unmaskSecrets(
          { vercelToken: masked.vercelToken, vercelApiBaseUrl },
          [appConfig],
          APP_CONFIG_SECRET_SLOTS
        ).vercelToken;

      expect(test()).toBe('vercel-token');
      expect(() => test('https://attacker.example')).toThrow(
        'A saved secret can only be sent to the address it was saved for'
      );
    });

    it('never lets a mask move to a secret of another destination', () => {
      const masked = maskSettingSecrets(SettingKey.AI_CONFIG, aiConfig);

      expect(() =>
        unmaskSettingSecrets(
          SettingKey.AI_CONFIG,
          { aiGatewayApiKey: masked.llmProviders[0].apiKey },
          aiConfig
        )
      ).toThrow('A saved secret can only be sent to the address it was saved for');
    });

    it('resolves a saved secret only while the endpoint it goes to is unchanged', () => {
      const stored = {
        llmProviders: [
          {
            type: 'openai',
            name: 'teable',
            apiKey: 'sk-one',
            baseUrl: 'https://api.openai.com/v1',
          },
        ],
        aiGatewayApiKey: 'vck-gateway',
        aiGatewayBaseUrl: 'https://ai-gateway.example/v1',
        realtimeTranscription: { apiKey: 'sk-voice', endpoint: 'https://api.openai.com/v1' },
      };
      const masked = maskSettingSecrets(SettingKey.AI_CONFIG, stored);
      const attacker = 'https://attacker.example/v1';
      const refusal = 'A saved secret can only be sent to the address it was saved for';

      expect(unmaskSettingSecrets(SettingKey.AI_CONFIG, masked, stored)).toEqual(stored);
      expect(() =>
        unmaskSettingSecrets(
          SettingKey.AI_CONFIG,
          { llmProviders: [{ ...masked.llmProviders[0], baseUrl: attacker }] },
          stored
        )
      ).toThrow(refusal);
      // A section patch leaves the gateway URL out: `next` carries the one being stored.
      const gatewayPatch = { aiGatewayApiKey: masked.aiGatewayApiKey };
      expect(
        unmaskSettingSecrets(SettingKey.AI_CONFIG, gatewayPatch, stored, {
          ...stored,
          ...gatewayPatch,
        })
      ).toEqual({ aiGatewayApiKey: 'vck-gateway' });
      expect(() =>
        unmaskSettingSecrets(SettingKey.AI_CONFIG, gatewayPatch, stored, {
          ...stored,
          aiGatewayBaseUrl: attacker,
        })
      ).toThrow(refusal);
      expect(() =>
        unmaskSettingSecrets(
          SettingKey.AI_CONFIG,
          { realtimeTranscription: { ...masked.realtimeTranscription, endpoint: attacker } },
          stored
        )
      ).toThrow(refusal);
      // No URL means the provider's official endpoint, never one the caller picks.
      expect(
        unmaskSettingSecrets(
          SettingKey.AI_CONFIG,
          { llmProviders: [{ ...masked.llmProviders[0], baseUrl: undefined }] },
          stored
        ).llmProviders[0].apiKey
      ).toBe('sk-one');
    });

    it('binds SMTP passwords to their server and OIDC secrets to their token URL', () => {
      const smtp = { host: 'smtp.example.com', port: 465, auth: { user: 'u', pass: 'pw' } };
      const maskedSmtp = maskSettingSecrets(SettingKey.NOTIFY_MAIL_TRANSPORT_CONFIG, smtp);
      const appConfig = {
        vercelToken: 'vercel-token',
        appAuth: {
          oidc: {
            tokenUrl: 'https://idp.example/token',
            clientId: 'c',
            clientSecret: 'oidc-secret',
          },
          emailOtp: { smtp },
        },
      };
      const maskedApp = maskSettingSecrets(SettingKey.APP_CONFIG, appConfig);
      const refusal = 'A saved secret can only be sent to the address it was saved for';

      expect(
        unmaskSettingSecrets(SettingKey.NOTIFY_MAIL_TRANSPORT_CONFIG, maskedSmtp, smtp)
      ).toEqual(smtp);
      expect(() =>
        unmaskSettingSecrets(
          SettingKey.NOTIFY_MAIL_TRANSPORT_CONFIG,
          { ...maskedSmtp, host: 'smtp.attacker.example' },
          smtp
        )
      ).toThrow(refusal);
      expect(unmaskSettingSecrets(SettingKey.APP_CONFIG, maskedApp, appConfig)).toEqual(appConfig);
      expect(() =>
        unmaskSettingSecrets(
          SettingKey.APP_CONFIG,
          {
            appAuth: {
              ...maskedApp.appAuth,
              oidc: { ...maskedApp.appAuth.oidc, tokenUrl: 'https://attacker.example/token' },
            },
          },
          appConfig
        )
      ).toThrow(refusal);
    });

    it('binds an SMTP password to its TLS mode, an unset flag meaning off', () => {
      const tls = {
        host: 'smtp.example.com',
        port: 465,
        secure: true,
        auth: { user: 'u', pass: 'pw' },
      };
      const masked = maskSettingSecrets(SettingKey.NOTIFY_MAIL_TRANSPORT_CONFIG, tls);
      const plainStored = { host: 'smtp.example.com', port: 587, auth: { user: 'u', pass: 'pw' } };
      const maskedPlain = maskSettingSecrets(SettingKey.NOTIFY_MAIL_TRANSPORT_CONFIG, plainStored);

      expect(() =>
        unmaskSettingSecrets(
          SettingKey.NOTIFY_MAIL_TRANSPORT_CONFIG,
          { ...masked, secure: false },
          tls
        )
      ).toThrow('A saved secret can only be sent to the address it was saved for');
      expect(
        unmaskSettingSecrets(
          SettingKey.NOTIFY_MAIL_TRANSPORT_CONFIG,
          { ...maskedPlain, secure: false },
          plainStored
        ).auth.pass
      ).toBe('pw');
    });

    it('lets gateway API keys stand in for each other, never the Vertex private key', () => {
      const stored = {
        llmProviders: [],
        aiGatewayApiKey: 'gw-main',
        concurrencyGroups: [{ id: 'g', name: 'g', keys: [{ apiKey: 'gw-group' }] }],
        vertexByokCredential: { googleCredentials: { privateKey: 'vx-pk', clientEmail: 'e' } },
      };
      const masked = maskSettingSecrets(SettingKey.AI_CONFIG, stored);
      const asGatewayKey = (mask: string) =>
        unmaskSecrets({ aiGatewayApiKey: mask }, [stored], AI_CONFIG_SECRET_SLOTS).aiGatewayApiKey;

      expect(asGatewayKey(masked.concurrencyGroups[0].keys[0].apiKey)).toBe('gw-group');
      expect(() => asGatewayKey(masked.vertexByokCredential.googleCredentials.privateKey)).toThrow(
        'A saved secret can only be sent to the address it was saved for'
      );
    });

    it('refuses a mask that no longer matches a stored secret', () => {
      const masked = maskSettingSecrets(SettingKey.APP_CONFIG, { vercelToken: 'old-token' });

      expect(() =>
        unmaskSettingSecrets(SettingKey.APP_CONFIG, masked, { vercelToken: 'rotated-token' })
      ).toThrow('changed since this page was loaded');
    });

    it('passes plaintext and settings without secrets through', () => {
      expect(
        unmaskSettingSecrets(SettingKey.APP_CONFIG, { vercelToken: 'typed' }, null).vercelToken
      ).toBe('typed');
      expect(maskSettingSecrets(SettingKey.BRAND_NAME, 'Teable')).toBe('Teable');
      expect(maskSettingSecrets(SettingKey.APP_CONFIG, null)).toBeNull();
    });
  });
});

describe('assertSettingSecretsReentered', () => {
  const stored = {
    aiGatewayBaseUrl: 'https://gateway.example/v1',
    aiGatewayApiKey: 'gw-key',
    aiGatewayApiKeys: ['pool-key'],
    vertexByokCredential: { googleCredentials: { privateKey: 'vertex-pk' } },
  };
  const moved = { aiGatewayBaseUrl: 'https://elsewhere.example/v1' };
  const check =
    (patch: unknown, saved: unknown = stored) =>
    () =>
      assertSettingSecretsReentered(SettingKey.AI_CONFIG, saved, patch);

  it('refuses a moved gateway URL that leaves stored gateway keys behind, naming them', () => {
    expect(check({ ...moved, aiGatewayApiKey: 'new' })).toThrow(
      /aiGatewayApiKeys, vertexByokCredential/
    );
  });

  it('accepts a moved URL once every stored gateway key comes with it, re-entered or cleared', () => {
    expect(
      check({ ...moved, aiGatewayApiKey: 'new', aiGatewayApiKeys: [], vertexByokCredential: null })
    ).not.toThrow();
  });

  it('lets other sections and a kept or default URL through', () => {
    expect(check({ chatModel: {} })).not.toThrow();
    expect(check({ aiGatewayBaseUrl: stored.aiGatewayBaseUrl })).not.toThrow();
    expect(check({ aiGatewayBaseUrl: null })).not.toThrow();
    expect(check(moved, { aiGatewayBaseUrl: 'https://a.example' })).not.toThrow();
  });
});

/**
 * Every setting fully populated, each secret unique: the matrix below walks the slot
 * declarations themselves, so a slot added later is covered without a new test.
 */
const SAMPLES: [name: string, slots: readonly ISecretSlot[], value: Record<string, unknown>][] = [
  [
    SettingKey.AI_CONFIG,
    AI_CONFIG_SECRET_SLOTS,
    {
      llmProviders: [
        { type: 'openai', name: 'p', apiKey: 'sk-p', baseUrl: 'https://llm.example/v1' },
      ],
      aiGatewayApiKey: 'gw-main',
      aiGatewayApiKeys: ['gw-pool'],
      aiGatewayBaseUrl: 'https://gw.example/v1',
      concurrencyGroups: [{ id: 'g', name: 'g', keys: [{ apiKey: 'gw-group' }] }],
      vertexByokCredential: { googleCredentials: { privateKey: 'vx-pk', clientEmail: 'e' } },
      realtimeTranscription: { apiKey: 'rt-key', endpoint: 'https://rt.example/v1' },
    },
  ],
  [
    SettingKey.APP_CONFIG,
    APP_CONFIG_SECRET_SLOTS,
    {
      vercelToken: 'vc-token',
      appAuth: {
        google: { clientId: 'g', clientSecret: 'google-secret' },
        oidc: { clientId: 'o', clientSecret: 'oidc-secret', tokenUrl: 'https://idp.example/t' },
        emailOtp: {
          smtp: { host: 'smtp.example', port: 465, auth: { user: 'u', pass: 'otp-pw' } },
        },
      },
    },
  ],
  [
    SettingKey.IM_CONFIG,
    IM_CONFIG_SECRET_SLOTS,
    {
      telegram: { botToken: 'tg-token' },
      feishu: { appSecret: 'fs-secret' },
      slack: { clientSecret: 'sl-client', signingSecret: 'sl-signing' },
    },
  ],
  [
    SettingKey.NOTIFY_MAIL_TRANSPORT_CONFIG,
    MAIL_TRANSPORT_SECRET_SLOTS,
    { host: 'smtp.example', port: 465, auth: { user: 'u', pass: 'mail-pw' } },
  ],
];

/** `value` with `field` of every `anchor` object set to `to` (`*` walks arrays). */
const setField = (
  value: unknown,
  anchor: readonly string[],
  field: readonly string[],
  to: unknown
): unknown => {
  if (anchor.length === 0) {
    if (field.length === 0) return to;
    const [key, ...rest] = field;
    const node = (value ?? {}) as Record<string, unknown>;
    return { ...node, [key]: setField(node[key], [], rest, to) };
  }
  const [key, ...rest] = anchor;
  if (key === '*') {
    return (value as unknown[]).map((item) => setField(item, rest, field, to));
  }
  const node = value as Record<string, unknown>;
  return { ...node, [key]: setField(node[key], rest, field, to) };
};

const strings = (value: unknown): string[] =>
  typeof value === 'string'
    ? [value]
    : value && typeof value === 'object'
      ? Object.values(value).flatMap(strings)
      : [];

const ENCRYPTION_MAPPERS: Record<string, (config: unknown, fn: (v: string) => string) => unknown> =
  {
    [SettingKey.AI_CONFIG]: mapAiConfigSecrets,
    [SettingKey.APP_CONFIG]: mapAppConfigSecrets,
    [SettingKey.IM_CONFIG]: mapImConfigSecrets,
    [SettingKey.NOTIFY_MAIL_TRANSPORT_CONFIG]: mapMailTransportConfigSecrets,
  };

describe.each(SAMPLES)('secret slots of %s', (name, slots, value) => {
  it('mask exactly the secrets the codec encrypts', () => {
    const encrypted: string[] = [];
    ENCRYPTION_MAPPERS[name](value, (secret) => {
      encrypted.push(secret);
      return secret;
    });
    const left = strings(maskSettingSecrets(name, value));
    const masked = strings(value).filter((v) => !left.includes(v));

    expect(masked.sort()).toEqual(encrypted.sort());
  });

  it('round-trip unchanged through mask and unmask', () => {
    expect(unmaskSettingSecrets(name, maskSettingSecrets(name, value), value)).toEqual(value);
  });

  const bound = slots.flatMap((slot) =>
    (slot.endpoint ?? []).map((field) => [slot, field] as const)
  );
  it.each(
    bound.map(([slot, field]) => [[...(slot.anchor ?? []), ...field.path].join('.'), slot, field])
  )('refuse a kept mask once %s changes', (_label, slot, field) => {
    const masked = maskSettingSecrets(name, value);
    const moved = setField(masked, slot.anchor ?? [], field.path, 'https://moved.example');

    expect(() => unmaskSettingSecrets(name, moved, value)).toThrow(
      'A saved secret can only be sent to the address it was saved for'
    );
    if (field.match === 'orDefault') {
      const cleared = setField(masked, slot.anchor ?? [], field.path, '');
      expect(unmaskSettingSecrets(name, cleared, value)).toEqual(
        setField(value, slot.anchor ?? [], field.path, '')
      );
    }
  });
});
