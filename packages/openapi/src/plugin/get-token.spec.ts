import { pluginGetTokenRoSchema, pluginGetTokenVoSchema } from './get-token';

const tokenRo = {
  baseId: 'bseTest',
  secret: 'secret',
  scopes: ['base|read', 'table|read', 'record|update'],
  authCode: 'auth-code',
};

const tokenVo = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  scopes: tokenRo.scopes,
  expiresIn: 600,
  refreshExpiresIn: 2592000,
};

describe('plugin token scopes', () => {
  it('accepts actions scoped to the current base', () => {
    expect(pluginGetTokenRoSchema.parse(tokenRo).scopes).toEqual(tokenRo.scopes);
    expect(pluginGetTokenVoSchema.parse(tokenVo).scopes).toEqual(tokenVo.scopes);
  });

  it('rejects empty scopes', () => {
    expect(() => pluginGetTokenRoSchema.parse({ ...tokenRo, scopes: [] })).toThrow();
    expect(() => pluginGetTokenVoSchema.parse({ ...tokenVo, scopes: [] })).toThrow();
  });

  it.each([
    'unknown|read',
    'base|delete',
    'base|create',
    'base|read_all',
    'space|read',
    'user|integrations',
    'instance|read',
    'enterprise|read',
  ])('rejects a scope outside the current base: %s', (scope) => {
    expect(() => pluginGetTokenRoSchema.parse({ ...tokenRo, scopes: [scope] })).toThrow();
    expect(() => pluginGetTokenVoSchema.parse({ ...tokenVo, scopes: [scope] })).toThrow();
  });
});
