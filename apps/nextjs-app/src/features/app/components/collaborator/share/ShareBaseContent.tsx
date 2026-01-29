import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { canManageRole, hasPermission, Role, type IBaseRole, type IRole } from '@teable/core';
import type { CollaboratorItem, IAddCollaborator } from '@teable/openapi';
import {
  addBaseCollaborator,
  CollaboratorType,
  createBaseInvitationLink,
  deleteBaseCollaborator,
  deleteBaseInvitationLink,
  emailBaseInvitation,
  getBaseCollaboratorList,
  listBaseInvitationLink,
  PrincipalType,
  updateBaseCollaborator,
  updateBaseInvitationLink,
} from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useSession } from '@teable/sdk/hooks';
import { Badge } from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { useRouter } from 'next/router';
import { Trans, useTranslation } from 'next-i18next';
import { useMemo, useState } from 'react';
import { useFilteredRoleStatic } from '../../collaborator-manage/base/useFilteredRoleStatic';
import { CollaboratorsDialog } from './CollaboratorsDialog';
import { AuthorityTips } from './common/AuthorityTips';
import { CollaboratorButton } from './common/CollaboratorButton';
import { CollaboratorTable } from './common/CollaboratorTable';
import { DebounceInput } from './common/DebounceInput';
import { EmailContent } from './common/EmailContent';
import { ShareHeader } from './common/Header';
import { InviteEmailButton } from './common/InviteEmailButton';
import { InviteLinkButton } from './common/InviteLinkButton';
import { InviteOrgButton } from './common/InviteOrgButton';
import { LinkContent } from './common/LinkContent';
import { OrgContent } from './common/OrgContent';

const MEMBERS_PER_PAGE = 50;
export const ShareBaseContent = ({
  baseId,
  baseName,
  role: userRole,
  enabledAuthority,
  onClose,
}: {
  baseId: string;
  baseName: string;
  role: IRole;
  enabledAuthority?: boolean;
  onClose: () => void;
}) => {
  const router = useRouter();
  const { user } = useSession();
  const { t } = useTranslation(['common', 'space']);

  const [tabType, setTabType] = useState<
    'email' | 'link' | 'collaborators' | 'organization' | undefined
  >();

  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const {
    data,
    hasNextPage,
    fetchNextPage,
    isLoading: isListLoading,
  } = useInfiniteQuery({
    queryKey: ReactQueryKeys.baseCollaboratorList(baseId, { includeSystem: true, search }),
    staleTime: 1000,
    refetchOnWindowFocus: false,
    queryFn: ({ queryKey, pageParam }) =>
      getBaseCollaboratorList(queryKey[1], {
        ...queryKey[2],
        skip: pageParam * MEMBERS_PER_PAGE,
        take: MEMBERS_PER_PAGE,
      }).then((res) => res.data),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => {
      const allCollaborators = pages.flatMap((page) => page.collaborators);
      return allCollaborators.length >= lastPage.total ? undefined : pages.length;
    },
  });

  const total = data?.pages?.[0]?.total || 0;
  const collaborators = useMemo(() => {
    return data?.pages.flatMap((page) => page.collaborators);
  }, [data]);

  const hasInviteLinkPermission = hasPermission(userRole, 'base|invite_link');
  const { data: linkList } = useQuery({
    queryKey: ['invite-link-list', baseId],
    queryFn: ({ queryKey }) => listBaseInvitationLink(queryKey[1]).then((res) => res.data),
    enabled: hasInviteLinkPermission,
  });

  const { mutate: emailInvitation, isPending: emailInvitationLoading } = useMutation({
    mutationFn: emailBaseInvitation,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.baseCollaboratorList(baseId),
      });
      onClose();
      toast.success(t('invite.sendInvitationSuccess'));
    },
  });

  const { mutate: createInviteLinkRequest, isPending: createInviteLinkLoading } = useMutation({
    mutationFn: createBaseInvitationLink,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invite-link-list'] });
    },
  });

  const { mutate: updateInviteLink, isPending: updateInviteLinkLoading } = useMutation({
    mutationFn: updateBaseInvitationLink,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invite-link-list'] });
    },
  });

  const { mutate: deleteInviteLink, isPending: deleteInviteLinkLoading } = useMutation({
    mutationFn: deleteBaseInvitationLink,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invite-link-list'] });
    },
  });

  const { mutate: deleteCollaborator, isPending: deleteCollaboratorLoading } = useMutation({
    mutationFn: deleteBaseCollaborator,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.baseCollaboratorList(baseId) });
    },
  });

  const { mutate: updateCollaborator, isPending: updateCollaboratorLoading } = useMutation({
    mutationFn: updateBaseCollaborator,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.baseCollaboratorList(baseId) });
    },
  });

  const { mutate: addCollaborators, isPending: addCollaboratorsLoading } = useMutation({
    mutationFn: async ({
      role,
      collaborators,
    }: {
      role: IRole;
      collaborators: IAddCollaborator[];
    }) => {
      const userCollaborators = collaborators.filter((c) => c.principalType === PrincipalType.User);
      const departmentCollaborators = collaborators.filter(
        (c) => c.principalType === PrincipalType.Department
      );
      if (userCollaborators.length > 0) {
        await addBaseCollaborator(baseId, {
          collaborators: userCollaborators,
          role: role as IBaseRole,
        });
      }
      if (departmentCollaborators.length > 0) {
        await addBaseCollaborator(baseId, {
          collaborators: departmentCollaborators,
          role: role as IBaseRole,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.baseCollaboratorList(baseId) });
      onClose();
      toast.success(t('invite.sendInvitationSuccess'));
    },
  });

  const toAuthorityManage = () => {
    router.push({
      pathname: '/base/[baseId]/authority-matrix',
      query: { baseId },
    });
  };

  const linkListCount = linkList?.length || 0;
  const onBack = () => setTabType(undefined);
  const defaultRole = userRole === Role.Owner ? Role.Creator : userRole;
  const filteredRoleStatic = useFilteredRoleStatic(defaultRole);

  if (tabType === 'link') {
    return (
      <LinkContent
        list={linkList}
        defaultRole={defaultRole}
        isCreateLoading={createInviteLinkLoading}
        isUpdateLoading={updateInviteLinkLoading}
        isDeleteLoading={deleteInviteLinkLoading}
        onCreate={(role) =>
          createInviteLinkRequest({
            baseId,
            createBaseInvitationLinkRo: { role: role as IBaseRole },
          })
        }
        onUpdate={(invitationId, role) =>
          updateInviteLink({
            invitationId,
            updateBaseInvitationLinkRo: { role: role as IBaseRole },
            baseId,
          })
        }
        onDelete={(invitationId) => deleteInviteLink({ invitationId, baseId })}
        onBack={onBack}
        filteredRoleStatic={filteredRoleStatic}
      />
    );
  }

  if (tabType === 'email') {
    return (
      <EmailContent
        defaultRole={defaultRole}
        isCreateLoading={emailInvitationLoading}
        onCreate={(ro) => emailInvitation({ baseId, emailBaseInvitationRo: ro })}
        onBack={onBack}
        filteredRoleStatic={filteredRoleStatic}
      />
    );
  }

  if (tabType === 'organization') {
    return (
      <OrgContent
        defaultRole={defaultRole}
        isCreateLoading={addCollaboratorsLoading}
        onCreate={(role, members) =>
          addCollaborators({ role: role as IRole, collaborators: members })
        }
        onBack={onBack}
        filteredRoleStatic={filteredRoleStatic}
      />
    );
  }
  const getPermissions = (item: CollaboratorItem) => {
    const canManage = canManageRole(userRole, item.role);
    const isMe = item.type === PrincipalType.User && item.userId === user.id;
    const isOwner = userRole === Role.Owner;
    const canOperator = canManage || isMe || isOwner;
    return {
      canUpdateRole: item.resourceType !== CollaboratorType.Space && canOperator,
      canDelete: canOperator,
      showDelete: item.resourceType === CollaboratorType.Base && canOperator,
    };
  };

  return (
    <div className="flex flex-col gap-4">
      <ShareHeader
        title={t('invite.base.title', { baseName })}
        description={
          <Trans ns="common" i18nKey={'invite.base.desc'} count={total} components={{ b: <b /> }} />
        }
      />
      {enabledAuthority && <AuthorityTips onViewDetail={toAuthorityManage} />}
      <div className="flex flex-col gap-5">
        <InviteEmailButton onClick={() => setTabType('email')} />
        {user?.organization && (
          <div className="space-y-2">
            <p className="text-sm font-semibold">{t('invite.addOrgCollaborator.title')}</p>
            <InviteOrgButton onClick={() => setTabType('organization')} />
          </div>
        )}
        {hasInviteLinkPermission && (
          <div className="relative space-y-2">
            <p className="text-sm font-semibold">{t('invite.dialog.tabLink')}</p>
            <InviteLinkButton
              className="box-content -translate-x-2 px-2 py-0"
              linkListCount={linkListCount}
              onClick={() => setTabType('link')}
            />
          </div>
        )}
        <div className="space-y-2">
          <p className="text-sm font-semibold">{t('invite.dialog.baseTitle')}</p>
          <CollaboratorsDialog
            title={t('invite.base.baseTitleWithCount', { count: total })}
            alert={
              enabledAuthority ? <AuthorityTips onViewDetail={toAuthorityManage} /> : undefined
            }
            list={collaborators || []}
            total={total}
            hasNextPage={hasNextPage}
            fetchNextPage={fetchNextPage}
            isLoading={false}
            content={
              <div className="flex flex-1 flex-col gap-2 overflow-hidden">
                <DebounceInput
                  value={search}
                  onChange={(value) => setSearch(value)}
                  placeholder={t('invite.base.collaboratorSearchPlaceholder')}
                />
                <CollaboratorTable
                  className="flex-1 overflow-y-auto rounded-md border"
                  list={collaborators || []}
                  total={total}
                  hasNextPage={hasNextPage}
                  fetchNextPage={fetchNextPage}
                  isLoading={isListLoading}
                  updateRoleLoading={updateCollaboratorLoading}
                  deleteLoading={deleteCollaboratorLoading}
                  filteredRoleStatic={filteredRoleStatic}
                  onUpdateRole={
                    enabledAuthority
                      ? undefined
                      : (role, item) => {
                          updateCollaborator({
                            baseId,
                            updateBaseCollaborateRo: {
                              principalId:
                                item.type === PrincipalType.User ? item.userId : item.departmentId,
                              principalType: item.type,
                              role: role as IBaseRole,
                            },
                          });
                        }
                  }
                  onDelete={(item) => {
                    deleteCollaborator({
                      baseId,
                      deleteBaseCollaboratorRo: {
                        principalId:
                          item.type === PrincipalType.User ? item.userId : item.departmentId,
                        principalType: item.type,
                      },
                    });
                  }}
                  getPermissions={getPermissions}
                  renderTips={(item) => {
                    return (
                      item.resourceType === CollaboratorType.Space && (
                        <Badge className="ml-2 text-xs font-normal" variant={'outline'}>
                          {t('noun.space')}
                        </Badge>
                      )
                    );
                  }}
                />
              </div>
            }
          >
            <CollaboratorButton
              collaborators={collaborators?.slice(0, 4) || []}
              total={total}
              onClick={() => setTabType('collaborators')}
              className="box-content -translate-x-2 px-2 py-0"
            />
          </CollaboratorsDialog>
        </div>
      </div>
    </div>
  );
};
