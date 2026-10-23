import { mcpOAuthScopes } from '@teable/core';
import * as bcrypt from 'bcrypt';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ClientRegistrationError, OAuthRegistrationService } from './oauth-registration.service';

const createService = () => {
  const prisma = {
    oAuthApp: {
      create: vi.fn().mockResolvedValue({ createdTime: new Date('2026-10-15T00:00:00Z') }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
  const cache = { incr: vi.fn().mockResolvedValue(1) };
  const config = {
    registrationRateLimit: 3,
    tokenRateWindow: '15m',
    dynamicClientRetention: '7d',
  };
  const service = new OAuthRegistrationService(prisma as never, cache as never, config as never);
  return { service, prisma, cache };
};

const expectRfcError = async (
  promise: Promise<unknown>,
  error: 'invalid_redirect_uri' | 'invalid_client_metadata'
) => {
  await expect(promise).rejects.toBeInstanceOf(ClientRegistrationError);
  await expect(promise).rejects.toMatchObject({ rfcError: error });
};

describe('OAuthRegistrationService', () => {
  let ctx: ReturnType<typeof createService>;

  beforeEach(() => {
    ctx = createService();
  });

  it('registers a public client with the MCP scopes by default', async () => {
    const res = await ctx.service.register(
      {
        client_name: ' Claude Code ',
        redirect_uris: ['http://localhost:4321/callback'],
        token_endpoint_auth_method: 'none',
      },
      '10.0.0.1'
    );
    expect(res.client_id).toMatch(/^cl/);
    expect(res.client_name).toBe('Claude Code');
    expect(res.token_endpoint_auth_method).toBe('none');
    expect(res.scope).toBe(mcpOAuthScopes.join(' '));
    expect(res.client_id_issued_at).toBe(Date.UTC(2026, 9, 15) / 1000);
    expect(ctx.prisma.oAuthApp.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          dynamicRegistration: true,
          allowDeviceFlow: false,
          createdBy: 'system',
          homepage: '',
          scopes: JSON.stringify(mcpOAuthScopes),
        }),
      })
    );
  });

  it('issues a secret to a client asking for client_secret_post, as claude.ai does', async () => {
    // claude.ai's registration body, verbatim apart from the scope list.
    const res = await ctx.service.register(
      {
        redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
        token_endpoint_auth_method: 'client_secret_post',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        scope: 'base|read record|read',
        client_name: 'Claude',
        application_type: 'web',
      } as never,
      '10.0.0.1'
    );
    expect(res.token_endpoint_auth_method).toBe('client_secret_post');
    expect(res.client_secret).toMatch(/^[a-z0-9]{40}$/);
    expect(res.client_secret_expires_at).toBe(0);
    const { data } = ctx.prisma.oAuthApp.create.mock.calls[0][0];
    const stored = data.secrets.create;
    // Only the hash is stored, never the secret itself.
    expect(stored.secret).not.toBe(res.client_secret);
    expect(await bcrypt.compare(res.client_secret!, stored.secret)).toBe(true);
    expect(stored.maskedSecret.endsWith(res.client_secret!.slice(-10))).toBe(true);
    expect(stored.createdBy).toBe('system');
  });

  it('issues no secret to a public client or when no method is given', async () => {
    for (const method of ['none', undefined]) {
      const res = await ctx.service.register(
        { redirect_uris: ['http://localhost:1/cb'], token_endpoint_auth_method: method },
        '10.0.0.1'
      );
      expect(res.token_endpoint_auth_method).toBe('none');
      expect(res.client_secret).toBeUndefined();
    }
    for (const [{ data }] of ctx.prisma.oAuthApp.create.mock.calls) {
      expect(data.secrets).toBeUndefined();
    }
  });

  it('drops the server alias Claude Code appends to its name, keeping the full name as description', async () => {
    const res = await ctx.service.register(
      { client_name: 'Claude Code (teable-local)', redirect_uris: ['http://localhost:1/cb'] },
      '10.0.0.1'
    );
    expect(res.client_name).toBe('Claude Code (teable-local)');
    expect(ctx.prisma.oAuthApp.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'Claude Code',
          description: 'Claude Code (teable-local)',
        }),
      })
    );
  });

  it('keeps a narrower scope set and the client_uri when given', async () => {
    const res = await ctx.service.register(
      {
        redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
        scope: 'base|read record|read base|read',
        client_uri: 'https://claude.ai',
      },
      '10.0.0.1'
    );
    expect(res.scope).toBe('base|read record|read');
    expect(res.client_uri).toBe('https://claude.ai');
    expect(res.client_name).toBe('OAuth client');
  });

  it('accepts https, loopback http and private-use scheme redirect URIs', async () => {
    const res = await ctx.service.register(
      {
        redirect_uris: [
          'https://vscode.dev/redirect',
          'http://127.0.0.1:33418/',
          'http://[::1]:8080/cb',
          'cursor://anysphere.cursor-retrieval/oauth/user-x/callback',
        ],
      },
      '10.0.0.1'
    );
    expect(res.redirect_uris).toHaveLength(4);
  });

  it.each([
    [{}, 'invalid_redirect_uri'],
    [{ redirect_uris: 'https://a.example/cb' }, 'invalid_redirect_uri'],
    [{ redirect_uris: ['http://evil.example/cb'] }, 'invalid_redirect_uri'],
    [{ redirect_uris: ['https://a.example/cb#x'] }, 'invalid_redirect_uri'],
    [{ redirect_uris: ['javascript:alert(1)'] }, 'invalid_redirect_uri'],
    [{ redirect_uris: ['/relative'] }, 'invalid_redirect_uri'],
    [
      { redirect_uris: Array.from({ length: 11 }, (_, i) => `https://a.example/${i}`) },
      'invalid_redirect_uri',
    ],
    [
      {
        redirect_uris: ['https://a.example/cb'],
        token_endpoint_auth_method: 'client_secret_basic',
      },
      'invalid_client_metadata',
    ],
    [
      { redirect_uris: ['https://a.example/cb'], scope: 'base|read admin|all' },
      'invalid_client_metadata',
    ],
    [
      { redirect_uris: ['https://a.example/cb'], scope: 'user|integrations' },
      'invalid_client_metadata',
    ],
    [{ redirect_uris: ['https://u:p@a.example/cb'] }, 'invalid_redirect_uri'],
    [{ redirect_uris: ['mailto:x@a.example'] }, 'invalid_redirect_uri'],
    [{ redirect_uris: [`https://a.example/${'x'.repeat(2048)}`] }, 'invalid_redirect_uri'],
    [
      { redirect_uris: ['https://a.example/cb'], grant_types: ['refresh_token'] },
      'invalid_client_metadata',
    ],
    [
      { redirect_uris: ['https://a.example/cb'], grant_types: ['implicit'] },
      'invalid_client_metadata',
    ],
    [
      { redirect_uris: ['https://a.example/cb'], response_types: ['token'] },
      'invalid_client_metadata',
    ],
    [
      { redirect_uris: ['https://a.example/cb'], client_name: 'x'.repeat(101) },
      'invalid_client_metadata',
    ],
    [
      { redirect_uris: ['https://a.example/cb'], client_uri: 'ftp://a.example' },
      'invalid_client_metadata',
    ],
  ] as const)('rejects %j with %s', async (body, error) => {
    await expectRfcError(ctx.service.register(body as never, '10.0.0.1'), error);
    expect(ctx.prisma.oAuthApp.create).not.toHaveBeenCalled();
  });

  it('rate limits per IP before touching the database', async () => {
    ctx.cache.incr.mockResolvedValueOnce(4);
    await expect(
      ctx.service.register({ redirect_uris: ['https://a.example/cb'] }, '10.0.0.1')
    ).rejects.toMatchObject({ status: 429 });
    expect(ctx.prisma.oAuthApp.create).not.toHaveBeenCalled();
  });

  it('prunes abandoned dynamic clients past the retention window on each registration', async () => {
    await ctx.service.register({ redirect_uris: ['https://a.example/cb'] }, '10.0.0.1');
    expect(ctx.prisma.oAuthApp.deleteMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        dynamicRegistration: true,
        authorized: { none: {} },
        tokens: { none: {} },
      }),
    });
  });
});
