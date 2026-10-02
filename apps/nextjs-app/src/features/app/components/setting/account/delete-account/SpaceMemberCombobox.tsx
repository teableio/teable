import { useQuery } from '@tanstack/react-query';
import type { IRole } from '@teable/core';
import { getSpaceCollaboratorList, PrincipalType } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk';
import { UserAvatar, UserOption } from '@teable/sdk/components';
import {
  Button,
  cn,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@teable/ui-lib/shadcn';
import { Building2, Check, ChevronsUpDown } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useMemo, useState } from 'react';
import { useDebounce } from 'react-use';
import { useRoleStatic } from '../../../collaborator-manage/useRoleStatic';

export interface ISpaceMember {
  principalType: PrincipalType;
  principalId: string;
  name: string;
  email?: string;
  avatar?: string | null;
  role: IRole;
}

const memberKey = (member: Pick<ISpaceMember, 'principalType' | 'principalId'>) =>
  `${member.principalType}:${member.principalId}`;

const PAGE_SIZE = 20;

interface ISpaceMemberComboboxProps {
  spaceId: string;
  value?: ISpaceMember;
  onChange: (member: ISpaceMember) => void;
  // Left out of the candidates, e.g. the current user
  excludeUserId?: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

// Searchable picker over the space-level collaborators (users and departments)
// with server-side search. Base collaborators are deliberately not included.
export const SpaceMemberCombobox = (props: ISpaceMemberComboboxProps) => {
  const { spaceId, value, onChange, excludeUserId, disabled, placeholder, className } = props;
  const { t } = useTranslation(['common']);
  const roleStatic = useRoleStatic();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useDebounce(() => setDebouncedSearch(search.trim()), 300, [search]);

  const { data, isLoading } = useQuery({
    queryKey: ReactQueryKeys.spaceCollaboratorList(spaceId, {
      take: PAGE_SIZE,
      search: debouncedSearch || undefined,
    }),
    queryFn: ({ queryKey }) =>
      getSpaceCollaboratorList(queryKey[1], queryKey[2]).then((res) => res.data),
  });

  const members = useMemo<ISpaceMember[]>(
    () =>
      (data?.collaborators ?? [])
        .filter((item) => item.type !== PrincipalType.User || item.userId !== excludeUserId)
        .map((item) =>
          item.type === PrincipalType.User
            ? {
                principalType: PrincipalType.User,
                principalId: item.userId,
                name: item.userName,
                email: item.email,
                avatar: item.avatar,
                role: item.role,
              }
            : {
                principalType: PrincipalType.Department,
                principalId: item.departmentId,
                name: item.departmentName,
                role: item.role,
              }
        ),
    [data, excludeUserId]
  );

  const roleName = (role: IRole) => roleStatic.find((item) => item.role === role)?.name ?? role;
  const avatarOf = (member: ISpaceMember, size: 'sm' | 'md') =>
    member.principalType === PrincipalType.Department ? (
      <div
        className={cn(
          'flex shrink-0 items-center justify-center rounded-full bg-accent',
          size === 'sm' ? 'size-5' : 'size-7'
        )}
      >
        <Building2 className={size === 'sm' ? 'size-3' : 'size-4'} />
      </div>
    ) : (
      member.avatar
    );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="xs"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn('h-7 min-w-0 justify-between font-normal', className)}
        >
          {value ? (
            <span className="flex min-w-0 items-center gap-2">
              <UserAvatar className="size-5" name={value.name} avatar={avatarOf(value, 'sm')} />
              <span className="truncate">{value.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{roleName(value.role)}</span>
            </span>
          ) : (
            <span className="truncate text-muted-foreground">{placeholder}</span>
          )}
          <ChevronsUpDown className="ms-1 size-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            value={search}
            onValueChange={setSearch}
            placeholder={placeholder}
            className="h-8 text-[13px]"
          />
          <CommandList>
            {!isLoading && members.length === 0 && (
              <CommandEmpty>{t('common:noResult')}</CommandEmpty>
            )}
            <CommandGroup>
              {members.map((member) => {
                const key = memberKey(member);
                const active = value != null && memberKey(value) === key;
                return (
                  <CommandItem
                    key={key}
                    value={key}
                    className="flex items-center gap-2"
                    onSelect={() => {
                      onChange(member);
                      setOpen(false);
                    }}
                  >
                    <UserOption
                      className="min-w-0 flex-1 gap-3"
                      name={member.name}
                      email={member.email}
                      avatar={avatarOf(member, 'md')}
                    />
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {roleName(member.role)}
                    </span>
                    <Check
                      className={cn('size-3 shrink-0', active ? 'opacity-100' : 'opacity-0')}
                    />
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};
