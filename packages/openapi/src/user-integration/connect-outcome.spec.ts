import { findChangedUserIntegration, userIntegrationBaseline } from './connect-outcome';
import type { IUserIntegrationItemVo } from './list';
import { UserIntegrationProvider } from './types';

const integration = (
  id: string,
  connectedTime?: string,
  provider = UserIntegrationProvider.Slack
): IUserIntegrationItemVo =>
  ({
    id,
    userId: 'usr1',
    provider,
    name: id,
    createdTime: '2026-01-01T00:00:00.000Z',
    connectedTime,
    hasSecret: true,
  }) as IUserIntegrationItemVo;

describe('findChangedUserIntegration', () => {
  it('finds the connection an attempt added', () => {
    const before = userIntegrationBaseline([], 'slack');
    const after = [integration('int1', '2026-09-17T10:00:00.000Z')];
    expect(findChangedUserIntegration(after, 'slack', before)?.id).toBe('int1');
  });

  it('finds a reconnect, which reuses the row and bumps connectedTime', () => {
    const rows = [integration('int1', '2026-09-17T10:00:00.000Z')];
    const before = userIntegrationBaseline(rows, 'slack');
    const after = [integration('int1', '2026-09-17T10:05:00.000Z')];
    expect(findChangedUserIntegration(after, 'slack', before)?.id).toBe('int1');
  });

  it('answers with nothing when the user only holds what they already held', () => {
    // A closed or denied consent screen: the list still shows the old connection.
    const rows = [integration('int1', '2026-09-17T10:00:00.000Z')];
    const before = userIntegrationBaseline(rows, 'slack');
    expect(findChangedUserIntegration(rows, 'slack', before)).toBeUndefined();
  });

  it('ignores other providers and connections with no credential of ours', () => {
    const before = userIntegrationBaseline([], 'slack');
    const other = integration('int2', '2026-09-17T10:00:00.000Z', UserIntegrationProvider.Airtable);
    const managed = { ...integration('int3', '2026-09-17T10:00:00.000Z'), hasSecret: false };
    expect(findChangedUserIntegration([other, managed], 'slack', before)).toBeUndefined();
  });

  it('is per provider, so another provider cannot waive the check', () => {
    const rows = [
      integration('int1', '2026-09-17T10:00:00.000Z'),
      integration('int2', '2026-09-17T10:00:00.000Z', UserIntegrationProvider.Airtable),
    ];
    expect(userIntegrationBaseline(rows, 'slack')).toEqual({
      int1: Date.parse('2026-09-17T10:00:00.000Z'),
    });
  });
});
