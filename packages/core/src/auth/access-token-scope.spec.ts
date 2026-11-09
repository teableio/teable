import {
  AccessTokenPreset,
  AccessTokenScopeGroup,
  AccessTokenScopeLevel,
  ACCESS_TOKEN_SCOPE_PARTIAL,
  accessTokenPresets,
  accessTokenScopeMap,
  getAccessTokenGroupActions,
  getAccessTokenGroupLevel,
  getAccessTokenPreset,
  getAccessTokenPresetScopes,
  setAccessTokenGroupLevel,
} from './access-token-scope';
import { allActions } from './actions';

describe('access token scope groups', () => {
  it('classifies every action exactly once', () => {
    expect(Object.keys(accessTokenScopeMap).sort()).toEqual([...allActions].sort());
  });

  it('round-trips every preset', () => {
    accessTokenPresets.forEach((preset) => {
      expect(getAccessTokenPreset(getAccessTokenPresetScopes(preset))).toBe(preset);
    });
  });

  it('keeps admin scopes and adds basic scopes when applying a preset', () => {
    const scopes = getAccessTokenPresetScopes(AccessTokenPreset.ReadOnly, [
      'instance|read',
      'record|delete',
    ]);
    expect(scopes).toContain('instance|read');
    expect(scopes).toContain('user|email_read');
    expect(scopes).not.toContain('record|delete');
    expect(scopes).toContain('record|read');
  });

  it('lets Edit data restore from the trash and Build delete projects', () => {
    const dataEditor = getAccessTokenPresetScopes(AccessTokenPreset.DataEditor);
    expect(dataEditor).toContain('table|trash_update');
    expect(dataEditor).not.toContain('field|delete');
    const builder = getAccessTokenPresetScopes(AccessTokenPreset.Builder);
    expect(builder).toEqual(expect.arrayContaining(['base|delete', 'user|integrations']));
  });

  it('only grants space management with full access', () => {
    expect(getAccessTokenPresetScopes(AccessTokenPreset.Builder)).not.toContain('space|grant_role');
    expect(getAccessTokenPresetScopes(AccessTokenPreset.FullAccess)).toContain('space|grant_role');
  });

  it('reports partial groups and custom presets', () => {
    const scopes = getAccessTokenPresetScopes(AccessTokenPreset.DataEditor).filter(
      (scope) => scope !== 'record|delete'
    );
    expect(getAccessTokenGroupLevel(scopes, AccessTokenScopeGroup.Data)).toBe(
      ACCESS_TOKEN_SCOPE_PARTIAL
    );
    expect(getAccessTokenPreset(scopes)).toBeNull();
  });

  it('matches the scopes the API dialog has always generated as partial data access', () => {
    const scopes = [
      'table|read',
      'field|read',
      'record|read',
      'record|create',
      'record|update',
      'record|delete',
    ];
    expect(getAccessTokenGroupLevel(scopes, AccessTokenScopeGroup.Data)).toBe(
      ACCESS_TOKEN_SCOPE_PARTIAL
    );
    expect(getAccessTokenGroupLevel(scopes, AccessTokenScopeGroup.Space)).toBe(
      AccessTokenScopeLevel.None
    );
  });

  it('sets a group level without touching other groups', () => {
    const scopes = setAccessTokenGroupLevel(
      ['record|read', 'space|read'],
      AccessTokenScopeGroup.Data,
      AccessTokenScopeLevel.Write
    );
    expect(scopes).toContain('space|read');
    expect(scopes).toEqual(
      expect.arrayContaining(getAccessTokenGroupActions(AccessTokenScopeGroup.Data).write)
    );
    expect(
      setAccessTokenGroupLevel(scopes, AccessTokenScopeGroup.Data, AccessTokenScopeLevel.None)
    ).toEqual(['space|read']);
  });
});
