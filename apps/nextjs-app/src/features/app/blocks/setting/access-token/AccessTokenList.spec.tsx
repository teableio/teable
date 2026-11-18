import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as OpenApi from '@teable/openapi';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test-utils';
import { AccessTokenList } from './AccessTokenList';

const api = vi.hoisted(() => ({ listAccessToken: vi.fn(), deleteAccessToken: vi.fn() }));
vi.mock('@teable/openapi', async (importOriginal) => ({
  ...(await importOriginal<typeof OpenApi>()),
  ...api,
}));

vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

type IAccessTokenItem = OpenApi.ListAccessTokenVo[number];

const token = (overrides: Partial<IAccessTokenItem>): IAccessTokenItem => ({
  id: 'accA',
  name: 'ci',
  scopes: ['record|read'],
  hasFullAccess: true,
  expiredTime: '2099-12-31T00:00:00.000Z',
  createdTime: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const renderList = (list: IAccessTokenItem[]) => {
  api.listAccessToken.mockResolvedValue({ data: list });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AccessTokenList onEdit={vi.fn()} />
    </QueryClientProvider>
  );
};

describe('AccessTokenList', () => {
  beforeEach(() => {
    api.listAccessToken.mockReset();
  });

  it('warns about a token that no longer works', async () => {
    renderList([
      token({ id: 'accGone', name: 'gone token', legacyCipher: { stopped: true } }),
      token({ id: 'accNew', name: 'new token' }),
    ]);

    expect(await screen.findByText('token:legacyCipher.bannerStopped')).toBeInTheDocument();
    const badges = screen.getAllByText('token:legacyCipher.badgeStopped');
    expect(badges).toHaveLength(1);
    expect(badges[0]).toHaveAttribute('title', 'token:legacyCipher.hintStopped');
    expect(badges[0].closest('tr')).toHaveTextContent('gone token');
  });

  it('only suggests regenerating a token that still works under an older key/iv', async () => {
    renderList([token({ name: 'old token', legacyCipher: { stopped: false } })]);

    expect(await screen.findByText('token:legacyCipher.bannerRotate')).toBeInTheDocument();
    expect(screen.getByText('token:legacyCipher.badgeRotate')).toHaveAttribute(
      'title',
      'token:legacyCipher.hintRotate'
    );
    expect(screen.queryByText('token:legacyCipher.bannerStopped')).toBeNull();
  });

  it('speaks for the stopped tokens first when there are both', async () => {
    renderList([
      token({ id: 'accGone', name: 'gone token', legacyCipher: { stopped: true } }),
      token({ id: 'accOld', name: 'old token', legacyCipher: { stopped: false } }),
    ]);

    expect(await screen.findByText('token:legacyCipher.bannerStopped')).toBeInTheDocument();
    expect(screen.queryByText('token:legacyCipher.bannerRotate')).toBeNull();
    expect(screen.getByText('token:legacyCipher.badgeRotate')).toBeInTheDocument();
  });

  it('shows no warning when no token is affected', async () => {
    renderList([token({ name: 'new token' })]);

    expect(await screen.findByText('new token')).toBeInTheDocument();
    expect(screen.queryByText(/token:legacyCipher\./)).toBeNull();
  });
});
