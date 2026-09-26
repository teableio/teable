import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as OpenApi from '@teable/openapi';
import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createAppContext } from '../../context/__tests__/createAppContext';
import type * as I18n from '../../context/app/i18n';
import type * as Hooks from '../../hooks';
import { RecordHistory } from './RecordHistory';

const { historyItem } = vi.hoisted(() => {
  const formulaMeta = {
    name: 'Title formula',
    type: 'formula',
    cellValueType: 'string',
    options: null,
  };
  return {
    historyItem: {
      id: 'rhiFormula',
      tableId: 'tblHistory',
      recordId: 'recHistory',
      fieldId: 'fldFormula',
      createdTime: '2026-09-16T00:00:00.000Z',
      createdBy: 'usrHistory',
      before: { meta: formulaMeta, data: 'before-formula' },
      after: { meta: formulaMeta, data: 'after-formula' },
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
        historyList: [historyItem],
        userMap: {
          usrHistory: {
            id: 'usrHistory',
            name: 'History User',
            email: 'history@example.com',
            avatar: null,
          },
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
    useTranslation: () => ({ t: (key: string) => key }),
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
