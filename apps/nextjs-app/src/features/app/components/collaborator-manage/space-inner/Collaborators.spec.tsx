import { useQuery } from '@tanstack/react-query';
import { Role } from '@teable/core';
import type { IGetSpaceVo } from '@teable/openapi';
import { CollaboratorType, PrincipalType } from '@teable/openapi';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import { Collaborators } from './Collaborators';

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
}));

vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/features/app/components/user/UserAvatar', () => ({
  UserAvatar: ({ user }: { user: { name: string } }) => <span>{user.name.slice(0, 1)}</span>,
}));

vi.mock('../../collaborator/space/InviteSpacePopover', () => ({
  InviteSpacePopover: ({ children }: { children: ReactNode }) => children,
}));

const uniqueBaseOnly = {
  type: PrincipalType.User as const,
  userId: 'usr1',
  userName: 'Alice',
  email: 'alice@example.com',
  avatar: null,
  lastSignTime: null,
  spaceRole: null,
  baseCount: 2,
  createdTime: '2026-07-20T00:00:00.000Z',
};

const basePermission = (id: string, name: string) => ({
  type: PrincipalType.User as const,
  resourceType: CollaboratorType.Base,
  userId: 'usr1',
  userName: 'Alice',
  email: 'alice@example.com',
  avatar: null,
  role: Role.Viewer,
  createdTime: '2026-07-21T00:00:00.000Z',
  lastSignTime: null,
  base: { id, name },
});

describe('space inner collaborators', () => {
  it('toggles a base-only principal and lazily shows its bases', () => {
    vi.mocked(useQuery).mockImplementation((options) => {
      const queryKey = (options as { queryKey: readonly unknown[] }).queryKey;
      if (queryKey[0] === 'space-unique-collaborator-list') {
        return {
          data: { collaborators: [uniqueBaseOnly], total: 1 },
        } as ReturnType<typeof useQuery>;
      }
      return {
        data: {
          collaborators: [basePermission('bse1', 'Projects'), basePermission('bse2', 'Hiring')],
          total: 2,
          uniqTotal: 1,
        },
      } as ReturnType<typeof useQuery>;
    });

    render(<Collaborators spaceId="spc1" space={{} as IGetSpaceVo} />);

    const row = screen.getByRole('button', { expanded: false });
    expect(row).toContainElement(screen.getByText('Alice'));
    expect(screen.queryByText('Projects')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Alice'));
    expect(screen.getByText('Projects')).toBeInTheDocument();
    expect(screen.getByText('Hiring')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { expanded: true }));
    expect(screen.queryByText('Projects')).not.toBeInTheDocument();
  });
});
