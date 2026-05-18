import type { IDataDbPreflightVo } from '@teable/openapi';
import { render, screen, userEvent } from '@/test-utils';
import { ByodbSpaceCreateSection } from './ByodbSpaceCreateSection';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const defaultProps = {
  mode: 'default' as const,
  url: '',
  onModeChange: vi.fn(),
  onUrlChange: vi.fn(),
  onTestConnection: vi.fn(),
};

describe('ByodbSpaceCreateSection', () => {
  it('lets users enable BYODB with the switch', async () => {
    const onModeChange = vi.fn();
    render(<ByodbSpaceCreateSection {...defaultProps} onModeChange={onModeChange} />);

    await userEvent.click(screen.getByRole('switch'));

    expect(onModeChange).toHaveBeenCalledWith('byodb');
  });

  it('renders preflight summary without exposing the password', () => {
    const result: IDataDbPreflightVo = {
      ok: true,
      provider: 'postgres',
      maskedUrl: 'postgresql://user:***@db.example.com/teable_byodb',
      urlFingerprint: 'fingerprint',
      displayHost: 'db.example.com',
      displayDatabase: 'teable_byodb',
      serverVersion: '16.3',
      classification: 'empty',
      availableDatabases: ['postgres', 'teable_byodb'],
      capabilities: {
        createSchema: true,
        createTable: true,
        createFunction: true,
        createTrigger: true,
        createRole: true,
        grantPrivileges: true,
        inspectActivity: true,
      },
      errors: [],
    };

    render(
      <ByodbSpaceCreateSection
        {...defaultProps}
        mode="byodb"
        url="postgresql://user:***@db.example.com/teable_byodb"
        preflightResult={result}
        testedUrl="postgresql://user:***@db.example.com/teable_byodb"
      />
    );

    expect(screen.getByText(/db.example.com/)).toBeInTheDocument();
    expect(screen.getAllByText(/teable_byodb/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/secret/)).not.toBeInTheDocument();
  });

  it('lets users choose a database when preflight returns candidates', async () => {
    const onUrlChange = vi.fn();
    const result: IDataDbPreflightVo = {
      ok: false,
      provider: 'postgres',
      maskedUrl: 'postgresql://user:***@db.example.com:5432',
      urlFingerprint: 'fingerprint',
      displayHost: 'db.example.com:5432',
      displayDatabase: '',
      serverVersion: '16.3',
      classification: 'non-empty-unknown',
      availableDatabases: ['postgres', 'teable_data'],
      requiresDatabaseSelection: true,
      capabilities: {
        createSchema: false,
        createTable: false,
        createFunction: false,
        createTrigger: false,
        createRole: false,
        grantPrivileges: false,
        inspectActivity: false,
      },
      errors: [],
    };

    render(
      <ByodbSpaceCreateSection
        {...defaultProps}
        mode="byodb"
        url="postgresql://user:secret@db.example.com:5432"
        preflightResult={result}
        testedUrl="postgresql://user:secret@db.example.com:5432"
        onUrlChange={onUrlChange}
      />
    );

    await userEvent.selectOptions(screen.getByRole('combobox'), 'teable_data');

    expect(onUrlChange).toHaveBeenCalledWith(
      'postgresql://user:secret@db.example.com:5432/teable_data'
    );
    expect(screen.queryByText(/dataDb.create.preflightFailed/)).not.toBeInTheDocument();
    expect(screen.queryByText(/dataDb.create.missingCapabilities/)).not.toBeInTheDocument();
  });

  it('renders IPv6 network errors without missing capability noise', () => {
    const result: IDataDbPreflightVo = {
      ok: false,
      provider: 'postgres',
      displayHost: 'db.example.com:5432',
      displayDatabase: 'postgres',
      classification: 'non-empty-unknown',
      capabilities: {
        createSchema: false,
        createTable: false,
        createFunction: false,
        createTrigger: false,
        createRole: false,
        grantPrivileges: false,
        inspectActivity: false,
      },
      errors: [
        {
          code: 'IPV6_NETWORK_UNREACHABLE',
          message: 'The database host resolved to an IPv6 address.',
          remediation: 'Use an IPv4-reachable database endpoint.',
        },
      ],
    };

    render(
      <ByodbSpaceCreateSection
        {...defaultProps}
        mode="byodb"
        url="postgresql://user:secret@db.example.com:5432/postgres"
        preflightResult={result}
        testedUrl="postgresql://user:secret@db.example.com:5432/postgres"
      />
    );

    expect(
      screen.getByText(/dataDb.create.errors.IPV6_NETWORK_UNREACHABLE.message/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/dataDb.create.missingCapabilities/)).not.toBeInTheDocument();
  });
});
