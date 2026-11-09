import { SettingKey, isMaskedSecret } from '@teable/openapi';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAiConfigValueCodec } from '../../utils/ai-config-encryption';
import { isEncryptedSecretValue } from '../../utils/secret-value-codec';
import { getThirdPartyCredentialCodec } from '../../utils/third-party-credential-encryption';
import {
  decryptSettingSecrets,
  encryptSettingSecrets,
  mapAppConfigSecrets,
  mapImConfigSecrets,
  mapMailTransportConfigSecrets,
  maskSettingSecrets,
  maskSettingsSecrets,
  unmaskSecret,
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

    it('resolves one masked secret against any of several stored settings', () => {
      const appConfig = {
        appAuth: { emailOtp: { smtp: { auth: { user: 'u', pass: 'otp-pw' } } } },
      };
      const masked = maskSettingSecrets(SettingKey.APP_CONFIG, appConfig);

      expect(
        unmaskSecret(masked.appAuth.emailOtp.smtp.auth.pass, {
          notifyMailTransportConfig: { auth: { user: 'u', pass: 'notify-pw' } },
          appConfig,
        })
      ).toBe('otp-pw');
    });

    it('refuses a mask that no longer matches a stored secret', () => {
      const masked = maskSettingSecrets(SettingKey.APP_CONFIG, { vercelToken: 'old-token' });

      expect(() =>
        unmaskSettingSecrets(SettingKey.APP_CONFIG, masked, { vercelToken: 'rotated-token' })
      ).toThrow('A masked secret no longer matches the saved value');
    });

    it('passes plaintext and settings without secrets through', () => {
      expect(unmaskSecret('sk-typed', { aiConfig })).toBe('sk-typed');
      expect(maskSettingSecrets(SettingKey.BRAND_NAME, 'Teable')).toBe('Teable');
      expect(maskSettingSecrets(SettingKey.APP_CONFIG, null)).toBeNull();
    });
  });
});
