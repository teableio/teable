import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import zh from '@teable/common-i18n/src/locales/zh/sdk.json';
import type * as OpenApi from '@teable/openapi';
import { render, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createAppContext } from '../../context/__tests__/createAppContext';
import type * as I18n from '../../context/app/i18n';
import type * as Hooks from '../../hooks';
import { RecordHistory } from './RecordHistory';

const { historyItem, legacyItem, unresolvedItem, resolvedAppItem } = vi.hoisted(() => {
  const formulaMeta = {
    name: 'Title formula',
    type: 'formula',
    cellValueType: 'string',
    options: null,
  };
  const base = {
    tableId: 'tblHistory',
    recordId: 'recHistory',
    fieldId: 'fldFormula',
    createdTime: '2026-09-16T00:00:00.000Z',
  };
  return {
    historyItem: {
      ...base,
      id: 'rhiFormula',
      createdBy: 'usrHistory',
      actorType: 'user',
      actorId: 'usrHistory',
      before: { meta: formulaMeta, data: 'before-formula' },
      after: { meta: formulaMeta, data: 'after-formula' },
    },
    // Pre-actor-storage row: the capability was off when it was written, so both actor fields are null.
    legacyItem: {
      ...base,
      id: 'rhiLegacy',
      createdBy: 'usrHistory',
      actorType: null,
      actorId: null,
      before: { meta: formulaMeta, data: 'before-legacy' },
      after: { meta: formulaMeta, data: 'after-legacy' },
    },
    // Actor recorded, but the host could not resolve a display name for it.
    unresolvedItem: {
      ...base,
      id: 'rhiUnresolved',
      createdBy: 'usrMissingExecutor',
      actorType: 'appUser',
      actorId: 'apu_fixture_unresolved',
      before: { meta: formulaMeta, data: 'before-unresolved' },
      after: { meta: formulaMeta, data: 'after-unresolved' },
    },
    resolvedAppItem: {
      ...base,
      id: 'rhiResolvedApp',
      createdBy: 'usrRobot',
      actorType: 'appUser',
      actorId: 'apu_fixture_member',
      before: { meta: formulaMeta, data: 'before-app' },
      after: { meta: formulaMeta, data: 'after-app' },
    },
  };
});

vi.mock('@teable/openapi', async (importOriginal) => {
  const actual = await importOriginal<typeof OpenApi>();
  return {
    ...actual,
    getFields: vi.fn().mockResolvedValue({ data: [] }),
    getRecordHistory: vi.fn().mockResolvedValue({
      data: {
        historyList: [historyItem, legacyItem, unresolvedItem, resolvedAppItem],
        userMap: {
          usrHistory: {
            id: 'usrHistory',
            name: 'History User',
            email: 'history@example.com',
            avatar: null,
          },
          usrRobot: {
            id: 'usrRobot',
            name: 'App Robot',
            email: 'robot@example.test',
            avatar: null,
          },
        },
        actorMap: {
          ['user:usrHistory']: {
            name: 'History User',
            avatar: null,
          },
          ['appUser:apu_fixture_unresolved']: null,
          ['appUser:apu_fixture_member']: { name: 'App Member', avatar: null },
        },
        nextCursor: null,
      },
    }),
    getRecordListHistory: vi.fn(),
    getUserCollaborators: vi.fn().mockResolvedValue({ data: { users: [] } }),
  };
});

vi.mock('../../hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof Hooks>();
  return {
    ...actual,
    useIsHydrated: () => true,
    useBaseId: () => undefined,
    useFieldStaticGetter: () => () => ({
      title: 'Formula',
      description: '',
      defaultOptions: {},
      Icon: () => null,
    }),
  };
});

vi.mock('../../context/app/i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof I18n>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, options?: { defaultValue?: string }) => {
        let value: unknown = zh;
        for (const segment of key.split('.')) {
          value =
            value && typeof value === 'object'
              ? (value as Record<string, unknown>)[segment]
              : undefined;
        }
        return typeof value === 'string' ? value : (options?.defaultValue ?? key);
      },
    }),
  };
});

vi.mock('../collaborator', () => ({
  CollaboratorWithHoverCard: ({ children }: { children?: unknown }) => children,
}));

const AppWrapper = createAppContext({ lang: 'en' });

const renderHistory = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <AppWrapper>
      <QueryClientProvider client={client}>
        <RecordHistory tableId="tblHistory" recordId="recHistory" />
      </QueryClientProvider>
    </AppWrapper>
  );
};

describe('RecordHistory formula cells T7388', () => {
  it('renders string formula history values from plain field meta', async () => {
    const { container } = renderHistory();

    await waitFor(() => {
      expect(container.textContent).toContain('before-formula');
      expect(container.textContent).toContain('after-formula');
    });
  });
});

describe('RecordHistory actor evidence', () => {
  it('Y4392 keeps App initiator and technical executor in separate columns', async () => {
    const view = renderHistory();
    const before = await view.findByText('before-app');
    const row = before.closest('tr');
    expect(row).not.toBeNull();
    expect(within(row!).getByText('App Member')).toBeInTheDocument();
    expect(within(row!).getByText('App Robot')).toBeInTheDocument();
  });

  it('Y4393 leaves a legacy actor unknown even when its executor has a known name', async () => {
    const view = renderHistory();
    const before = await view.findByText('before-legacy');
    const row = before.closest('tr');
    expect(row).not.toBeNull();
    expect(within(row!).getByText('未知')).toBeInTheDocument();
    expect(within(row!).getAllByText('History User')).toHaveLength(1);
    expect(within(row!).getByText('after-legacy')).toBeInTheDocument();
  });

  it('keeps legacy and unresolved actor rows with their values and identity fallbacks', async () => {
    const { container } = renderHistory();

    await waitFor(() => {
      // A row written before actor storage existed still renders its before/after values.
      expect(container.textContent).toContain('before-legacy');
      expect(container.textContent).toContain('after-legacy');
      // A row whose actor could not be resolved also keeps its values.
      expect(container.textContent).toContain('before-unresolved');
      expect(container.textContent).toContain('after-unresolved');
      expect(container.textContent).toContain('未知');
      expect(container.textContent).toContain('App 用户 · apu_fixture_unresolved');
      expect(container.textContent).not.toContain('appUser · apu_fixture_unresolved');
      // The technical executor stays visible even when userMap has no entry for it.
      expect(container.textContent).toContain('usrMissingExecutor');
    });
  });
});
