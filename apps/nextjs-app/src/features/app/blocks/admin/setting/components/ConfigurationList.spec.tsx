import type { ISettingVo } from '@teable/openapi';
import { render, screen } from '@/test-utils';
import type { IList } from './ConfigurationList';
import { ConfigurationList, useSecurityItems } from './ConfigurationList';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { total?: number }) =>
      options?.total === undefined ? key : `${key}:${options.total}`,
  }),
  Trans: ({ i18nKey }: { i18nKey: string }) => <span>{i18nKey}</span>,
}));

vi.mock('next/router', () => ({
  useRouter: () => ({ pathname: '/admin/setting', push: vi.fn() }),
}));

const systemItem: IList = {
  title: 'https',
  key: 'https',
  isRequired: true,
  isComplete: true,
  group: 'system',
  path: '/admin/setting',
};

// Signup closed by default so each case only exercises what it is about.
const Harness = (props: Partial<ISettingVo>) => {
  const securityItems = useSecurityItems({ instanceId: 'ins', disallowSignUp: true, ...props });
  return <ConfigurationList list={[systemItem, ...securityItems]} />;
};

const missing = (envKey: string) => ({ envKey, reason: 'missing' as const });
const SIGNUP_WARNING = 'admin.configuration.list.signupVerification.description';
const SIGNUP_TITLE = 'admin.configuration.list.signupVerification.title';
const SECRETS_TITLE = 'admin.configuration.list.secrets.title';

describe('ConfigurationList security items', () => {
  it('lists the security group before the others', () => {
    render(<Harness insecureSecrets={[missing('SECRET_KEY')]} />);
    const groups = screen
      .getAllByText(/^admin\.configuration\.group\./)
      .map((node) => node.textContent);
    expect(groups).toEqual([
      'admin.configuration.group.security',
      'admin.configuration.group.system',
    ]);
  });

  it('warns about squatting while signup is open without email verification', () => {
    render(<Harness disallowSignUp={false} enableEmailVerification={false} />);
    expect(screen.getByText(SIGNUP_TITLE)).toBeVisible();
    expect(screen.getByText(SIGNUP_WARNING)).toBeInTheDocument();
  });

  it('hides the signup entry when signup is closed or email is verified', () => {
    const { unmount } = render(<Harness disallowSignUp={false} enableEmailVerification />);
    expect(screen.queryByText(SIGNUP_TITLE)).not.toBeInTheDocument();
    unmount();

    render(<Harness disallowSignUp enableEmailVerification={false} />);
    expect(screen.queryByText(SIGNUP_TITLE)).not.toBeInTheDocument();
  });

  it('lists every secret by reason, with a link to the variable reference', () => {
    const keys = ['SECRET_KEY', 'BACKEND_SESSION_SECRET', 'SANDBOX_JWT_SECRET'];
    render(
      <Harness
        insecureSecrets={[
          ...keys.map(missing),
          { envKey: 'BACKEND_JWT_SECRET', reason: 'publicDefault' },
        ]}
      />
    );
    for (const key of [...keys, 'BACKEND_JWT_SECRET']) {
      expect(screen.getByText(key)).toBeInTheDocument();
    }
    expect(screen.getByText('admin.configuration.list.secrets.missing')).toBeInTheDocument();
    expect(screen.getByText('admin.configuration.list.secrets.publicDefault')).toBeInTheDocument();
    expect(screen.getByText('admin.configuration.list.secrets.docsLink')).toHaveAttribute(
      'href',
      'admin.configuration.list.secrets.href'
    );
  });

  it('hides the secrets entry once every secret is configured', () => {
    render(<Harness insecureSecrets={[]} />);
    expect(screen.queryByText(SECRETS_TITLE)).not.toBeInTheDocument();
  });

  it('drops the security group when nothing is at risk', () => {
    render(<Harness insecureSecrets={[]} />);
    expect(screen.queryByText('admin.configuration.group.security')).not.toBeInTheDocument();
    expect(screen.getByText('admin.configuration.group.system')).toBeInTheDocument();
  });

  it('adds no secrets entry when the backend does not report them', () => {
    render(<Harness />);
    expect(screen.queryByText(SECRETS_TITLE)).not.toBeInTheDocument();
  });
});
