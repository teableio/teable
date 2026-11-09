import type { ISettingVo } from '@teable/openapi';
import { getSetting } from '@teable/openapi';
import { render, screen, userEvent, waitFor } from '@/test-utils';
import { AdminTodoBanner } from './AdminTodoBanner';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  Trans: ({ i18nKey }: { i18nKey: string }) => <span>{i18nKey}</span>,
}));

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const session = vi.hoisted(() => ({
  user: undefined as { id: string; isAdmin?: boolean | null } | undefined,
  isCloud: false,
}));

vi.mock('@teable/sdk/hooks', () => ({ useSession: () => ({ user: session.user }) }));
vi.mock('@/features/app/hooks/useIsCloud', () => ({ useIsCloud: () => session.isCloud }));
vi.mock('@teable/openapi', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getSetting: vi.fn(),
}));

const MESSAGE = 'admin.configuration.banner.message';
const ACTION = 'admin.configuration.banner.action';

// Signup closed by default so each case only exercises what it is about.
const respond = (setting: Partial<ISettingVo>) =>
  vi.mocked(getSetting).mockResolvedValue({
    data: { instanceId: 'ins', disallowSignUp: true, ...setting },
  } as Awaited<ReturnType<typeof getSetting>>);

const secretMissing = { insecureSecrets: [{ envKey: 'SECRET_KEY', reason: 'missing' as const }] };

describe('AdminTodoBanner', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(getSetting).mockReset();
    session.user = { id: 'usrAdmin', isAdmin: true };
    session.isCloud = false;
  });

  it('points an admin with security to-dos at the admin checklist', async () => {
    respond(secretMissing);
    render(<AdminTodoBanner />);
    expect(await screen.findByText(MESSAGE)).toBeInTheDocument();
    expect(screen.getByText(ACTION).closest('a')).toHaveAttribute('href', '/admin/setting');
  });

  it('stays away from non-admins and cloud, and never asks for the admin setting', async () => {
    respond(secretMissing);
    session.user = { id: 'usrMember', isAdmin: null };
    const { unmount } = render(<AdminTodoBanner />);
    unmount();
    session.user = { id: 'usrAdmin', isAdmin: true };
    session.isCloud = true;
    render(<AdminTodoBanner />);
    await Promise.resolve();
    expect(getSetting).not.toHaveBeenCalled();
    expect(screen.queryByText(MESSAGE)).not.toBeInTheDocument();
  });

  it('shows nothing once every security item is handled', async () => {
    respond({ insecureSecrets: [] });
    render(<AdminTodoBanner />);
    await waitFor(() => expect(getSetting).toHaveBeenCalled());
    await Promise.resolve();
    expect(screen.queryByText(MESSAGE)).not.toBeInTheDocument();
  });

  it('stays dismissed until the set of risks changes', async () => {
    respond(secretMissing);
    const first = render(<AdminTodoBanner />);
    await userEvent.click(await screen.findByRole('button', { name: 'actions.close' }));
    expect(screen.queryByText(MESSAGE)).not.toBeInTheDocument();
    first.unmount();

    const again = render(<AdminTodoBanner />);
    await waitFor(() => expect(getSetting).toHaveBeenCalledTimes(2));
    await Promise.resolve();
    expect(screen.queryByText(MESSAGE)).not.toBeInTheDocument();
    again.unmount();

    // signup opened without email verification: a new risk brings it back
    respond({ ...secretMissing, disallowSignUp: false });
    render(<AdminTodoBanner />);
    expect(await screen.findByText(MESSAGE)).toBeInTheDocument();
  });
});
