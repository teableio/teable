import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Role, type IRole } from '@teable/core';
import type { CollaboratorItem, UniqueCollaboratorItem } from '@teable/openapi';
import { CollaboratorType, PrincipalType } from '@teable/openapi';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { vi } from 'vitest';
import { CollaboratorTable } from './CollaboratorTable';

const getSpaceCollaboratorListMock = vi.fn();

vi.mock('@teable/openapi', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getSpaceCollaboratorList: (...args: unknown[]) => getSpaceCollaboratorListMock(...args),
  };
});

vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, context?: { count?: number; name?: string }) =>
      [key, context?.count, context?.name].filter((value) => value != null).join(':'),
  }),
}));

vi.mock('../../../collaborator-manage/components/Collaborator', () => ({
  Collaborator: ({ item }: { item: { name: string; email?: string } }) => (
    <div>
      <span>{item.name}</span>
      {item.email && <span>{item.email}</span>}
    </div>
  ),
}));

vi.mock('../../../collaborator-manage/components/RoleSelect', () => ({
  RoleSelect: ({ value, onChange }: { value: IRole; onChange?: (role: IRole) => void }) => (
    <button type="button" onClick={() => onChange?.(Role.Creator)}>
      role:{value}
    </button>
  ),
}));

vi.mock('../../../collaborator-manage/useRoleStatic', () => ({
  useRoleStatic: () => [],
}));

const spacePermission: CollaboratorItem = {
  type: PrincipalType.User,
  resourceType: CollaboratorType.Space,
  userId: 'usr1',
  userName: 'Alice',
  email: 'alice@example.com',
  avatar: null,
  role: Role.Creator,
  createdTime: '2026-07-20T00:00:00.000Z',
  lastSignTime: '2026-07-22T00:00:00.000Z',
};

const basePermission = (id: string, name: string): CollaboratorItem => ({
  ...spacePermission,
  resourceType: CollaboratorType.Base,
  role: Role.Viewer,
  createdTime: '2026-07-21T00:00:00.000Z',
  base: { id, name },
});

const uniqueMember: UniqueCollaboratorItem = {
  type: PrincipalType.User,
  userId: 'usr1',
  userName: 'Alice',
  email: 'alice@example.com',
  avatar: null,
  lastSignTime: '2026-07-22T00:00:00.000Z',
  spaceRole: Role.Creator,
  baseCount: 0,
  createdTime: '2026-07-20T00:00:00.000Z',
};

const uniqueBaseOnly: UniqueCollaboratorItem = {
  ...uniqueMember,
  spaceRole: null,
  baseCount: 2,
};

const defaultProps = {
  total: 2,
  fetchNextPage: vi.fn(),
  isLoading: false,
  updateRoleLoading: false,
  deleteLoading: false,
  getPermissions: () => ({ canUpdateRole: true, canDelete: true, showDelete: true }),
  getFilteredRoleStatic: () => [],
};

const renderWithClient = (ui: ReactElement) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
};

beforeEach(() => {
  getSpaceCollaboratorListMock.mockReset();
  getSpaceCollaboratorListMock.mockResolvedValue({
    data: {
      collaborators: [basePermission('bse1', 'Projects'), basePermission('bse2', 'Hiring')],
      total: 2,
      uniqTotal: 1,
    },
  });
});

describe('CollaboratorTable flat mode', () => {
  it('renders a Base collaborator with the collaborator removal action', () => {
    const onDelete = vi.fn();
    const permission = basePermission('bse1', 'Projects');

    renderWithClient(
      <CollaboratorTable
        {...defaultProps}
        list={[permission]}
        total={1}
        onUpdateRole={vi.fn()}
        onDelete={onDelete}
      />
    );

    const row = screen.getByText('Alice').closest('tr');
    expect(row).not.toBeNull();
    const removeButton = within(row!).getByRole('button', {
      name: 'invite.dialog.collaboratorRemove',
    });
    expect(row!.querySelector('.lucide-log-out')).toBeInTheDocument();
    expect(row!.querySelector('.lucide-x')).not.toBeInTheDocument();

    fireEvent.click(removeButton);
    expect(onDelete).toHaveBeenCalledWith(permission);
  });
});

describe('CollaboratorTable grouped mode', () => {
  it('renders a space member as a single row acting on the synthetic space item', () => {
    const onUpdateRole = vi.fn();
    const onDelete = vi.fn();
    const { container } = renderWithClient(
      <CollaboratorTable
        {...defaultProps}
        groupByPrincipal
        spaceId="spc1"
        uniqueList={[uniqueMember]}
        total={1}
        onUpdateRole={onUpdateRole}
        onDelete={onDelete}
      />
    );

    const row = screen.getByText('Alice').closest('tr');
    expect(row).not.toBeNull();
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(screen.queryByRole('button', { expanded: true })).not.toBeInTheDocument();
    // no lazy permission fetch for whole-space members
    expect(getSpaceCollaboratorListMock).not.toHaveBeenCalled();

    fireEvent.click(within(row!).getByRole('button', { name: 'role:creator' }));
    fireEvent.click(within(row!).getByRole('button', { name: 'invite.dialog.collaboratorRemove' }));
    expect(onUpdateRole).toHaveBeenCalledWith(
      Role.Creator,
      expect.objectContaining({
        userId: 'usr1',
        role: Role.Creator,
        resourceType: CollaboratorType.Space,
      })
    );
    expect(onDelete).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'usr1', resourceType: CollaboratorType.Space })
    );
  });

  it('lets a member with extra base grants expand to reveal and manage them', async () => {
    const onDelete = vi.fn();
    renderWithClient(
      <CollaboratorTable
        {...defaultProps}
        groupByPrincipal
        spaceId="spc1"
        uniqueList={[{ ...uniqueMember, baseCount: 2 }]}
        total={1}
        onUpdateRole={vi.fn()}
        onDelete={onDelete}
      />
    );

    // member row still shows its space role plus a base-count badge, collapsed
    expect(screen.getByRole('button', { name: 'role:creator' })).toBeInTheDocument();
    expect(screen.getByText('noun.base · 2')).toBeInTheDocument();
    expect(getSpaceCollaboratorListMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { expanded: false }));
    const projectRow = (await screen.findByText('Projects')).closest('tr');
    fireEvent.click(
      within(projectRow!).getByRole('button', { name: 'invite.dialog.basePermissionRemove' })
    );
    expect(onDelete).toHaveBeenCalledWith(
      expect.objectContaining({ base: { id: 'bse1', name: 'Projects' } })
    );
  });

  it('removes all base grants of a base-only principal from the header row', () => {
    const onDeletePrincipal = vi.fn();
    renderWithClient(
      <CollaboratorTable
        {...defaultProps}
        groupByPrincipal
        spaceId="spc1"
        uniqueList={[uniqueBaseOnly]}
        total={1}
        onUpdateRole={vi.fn()}
        onDelete={vi.fn()}
        onDeletePrincipal={onDeletePrincipal}
      />
    );

    // header shows the earliest joined-at date instead of an empty cell
    expect(
      screen.getByText(new Date(uniqueBaseOnly.createdTime).toLocaleDateString())
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'invite.dialog.collaboratorRemove' }));
    expect(onDeletePrincipal).toHaveBeenCalledWith(uniqueBaseOnly);
    // clicking the action must not toggle the group open
    expect(getSpaceCollaboratorListMock).not.toHaveBeenCalled();
  });

  it('starts collapsed showing the base count and lazily loads on expand', async () => {
    renderWithClient(
      <CollaboratorTable
        {...defaultProps}
        groupByPrincipal
        spaceId="spc1"
        uniqueList={[uniqueBaseOnly]}
        total={1}
        onUpdateRole={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    // collapsed by default: badge with the base count, no permission fetch yet
    expect(screen.getByText('noun.base · 2')).toBeInTheDocument();
    expect(screen.queryByText('Projects')).not.toBeInTheDocument();
    expect(getSpaceCollaboratorListMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(await screen.findByText('Projects')).toBeInTheDocument();
    expect(screen.getByText('Hiring')).toBeInTheDocument();
    expect(getSpaceCollaboratorListMock).toHaveBeenCalledWith(
      'spc1',
      expect.objectContaining({ principalId: 'usr1', includeBase: true })
    );

    fireEvent.click(screen.getByRole('button', { expanded: true }));
    expect(screen.queryByText('Projects')).not.toBeInTheDocument();
    expect(screen.queryByText('Hiring')).not.toBeInTheDocument();
  });

  it('passes the selected permission row to update and delete callbacks', async () => {
    const onUpdateRole = vi.fn();
    const onDelete = vi.fn();

    renderWithClient(
      <CollaboratorTable
        {...defaultProps}
        groupByPrincipal
        spaceId="spc1"
        uniqueList={[uniqueBaseOnly]}
        total={1}
        onUpdateRole={onUpdateRole}
        onDelete={onDelete}
      />
    );

    fireEvent.click(screen.getByRole('button', { expanded: false }));
    const projectRow = (await screen.findByText('Projects')).closest('tr');
    expect(projectRow).not.toBeNull();
    expect(projectRow).toHaveClass('h-12', 'bg-muted', 'hover:bg-accent', '[&>td]:py-1');
    fireEvent.click(within(projectRow!).getByRole('button', { name: 'role:viewer' }));
    fireEvent.click(
      within(projectRow!).getByRole('button', { name: 'invite.dialog.basePermissionRemove' })
    );

    await waitFor(() => {
      expect(onUpdateRole).toHaveBeenCalledWith(
        Role.Creator,
        expect.objectContaining({ base: { id: 'bse1', name: 'Projects' } })
      );
    });
    expect(onDelete).toHaveBeenCalledWith(
      expect.objectContaining({ base: { id: 'bse1', name: 'Projects' } })
    );
    expect(projectRow!.querySelector('.lucide-x')).toBeInTheDocument();
  });
});
