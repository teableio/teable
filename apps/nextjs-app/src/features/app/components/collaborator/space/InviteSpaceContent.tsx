import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { canManageRole, hasPermission, Role, type IBaseRole, type IRole } from '@teable/core';
import type {
  CollaboratorItem,
  IAddCollaborator,
  UpdateBaseCollaborateRo,
  UpdateSpaceCollaborateRo,
} from '@teable/openapi';
import {
  addSpaceCollaborator,
  CollaboratorType,
  createSpaceInvitationLink,
  deleteBaseCollaborator,
  deleteSpaceCollaborator,
  deleteSpaceInvitationLink,
  emailSpaceInvitation,
  getSpaceCollaboratorList,
  listSpaceInvitationLink,
  PrincipalType,
  updateBaseCollaborator,
  updateSpaceCollaborator,
  updateSpaceInvitationLink,
} from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useSession } from '@teable/sdk/hooks';
import { Badge } from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { Trans, useTranslation } from 'next-i18next';
import { useMemo, useState } from 'react';
import { useFilteredRoleStatic as useFilteredBaseRoleStatic } from '../../collaborator-manage/base/useFilteredRoleStatic';
import { useFilteredRoleStatic } from '../../collaborator-manage/space/useFilteredRoleStatic';
import { CollaboratorsDialog } from '../share/CollaboratorsDialog';
import { CollaboratorButton } from '../share/common/CollaboratorButton';
import { CollaboratorTable } from '../share/common/CollaboratorTable';
import { DebounceInput } from '../share/common/DebounceInput';
import { EmailContent } from '../share/common/EmailContent';
import { ShareHeader } from '../share/common/Header';
import { InviteEmailButton } from '../share/common/InviteEmailButton';
import { InviteLinkButton } from '../share/common/InviteLinkButton';
import { InviteOrgButton } from '../share/common/InviteOrgButton';
import { LinkContent } from '../share/common/LinkContent';
import { OrgContent } from '../share/common/OrgContent';

interface IInviteSpaceContentProps {
  spaceId: string;
  spaceName: string;
  role: IRole;
  onClose: () => void;
}

const MEMBERS_PER_PAGE = 50;

const inviteLinkQueryKey = (spaceId: string) => ['space-invite-link-list', spaceId] as const;

export const InviteSpaceContent = (props: IInviteSpaceContentProps) => {
  const { spaceId, spaceName, role: userRole, onClose } = props;
  const { t } = useTranslation('common');
  const { user } = useSession();
  const [tabType, setTabType] = useState<'email' | 'organization' | 'link' | 'collaborators'>();

  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const {
    data,
    hasNextPage,
    fetchNextPage,
    isLoading: isListLoading,
  } = useInfiniteQuery({
    queryKey: ReactQueryKeys.spaceCollaboratorList(spaceId, {
      includeSystem: true,
      search,
      includeBase: true,
    }),
    staleTime: 1000,
    refetchOnWindowFocus: false,
    queryFn: ({ queryKey, pageParam }) =>
      getSpaceCollaboratorList(queryKey[1], {
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

  const hasInviteLinkPermission = hasPermission(userRole, 'space|invite_link');
  const { data: linkList } = useQuery({
    queryKey: inviteLinkQueryKey(spaceId),
    queryFn: ({ queryKey }) => listSpaceInvitationLink(queryKey[1]).then((res) => res.data),
    enabled: hasInviteLinkPermission,
  });

  const { mutate: emailInvitation, isPending: emailInvitationLoading } = useMutation({
    mutationFn: emailSpaceInvitation,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.spaceCollaboratorList(spaceId),
      });
      onClose();
      toast.success(t('invite.sendInvitationSuccess'));
    },
  });

  const { mutate: createInviteLinkRequest, isPending: createInviteLinkLoading } = useMutation({
    mutationFn: createSpaceInvitationLink,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inviteLinkQueryKey(spaceId) });
    },
  });

  const { mutate: updateInviteLink, isPending: updateInviteLinkLoading } = useMutation({
    mutationFn: updateSpaceInvitationLink,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inviteLinkQueryKey(spaceId) });
    },
  });

  const { mutate: deleteInviteLink, isPending: deleteInviteLinkLoading } = useMutation({
    mutationFn: deleteSpaceInvitationLink,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inviteLinkQueryKey(spaceId) });
    },
  });

  const { mutate: deleteCollaborator, isPending: deleteCollaboratorLoading } = useMutation({
    mutationFn: ({
      resourceId,
      principalId,
      principalType,
      isBase,
    }: {
      resourceId: string;
      principalId: string;
      principalType: PrincipalType;
      isBase: boolean;
    }) =>
      isBase
        ? deleteBaseCollaborator({
            baseId: resourceId,
            deleteBaseCollaboratorRo: { principalId, principalType },
          })
        : deleteSpaceCollaborator({
            spaceId: resourceId,
            deleteSpaceCollaboratorRo: { principalId, principalType },
          }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.spaceCollaboratorList(spaceId) });
    },
  });

  const { mutate: updateCollaborator, isPending: updateCollaboratorLoading } = useMutation({
    mutationFn: ({
      resourceId,
      isBase,
      updateCollaborateRo,
    }: {
      resourceId: string;
      isBase: boolean;
      updateCollaborateRo: UpdateSpaceCollaborateRo;
    }) =>
      isBase
        ? updateBaseCollaborator({
            baseId: resourceId,
            updateBaseCollaborateRo: updateCollaborateRo as UpdateBaseCollaborateRo,
          })
        : updateSpaceCollaborator({
            spaceId: resourceId,
            updateSpaceCollaborateRo: updateCollaborateRo,
          }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.spaceCollaboratorList(spaceId) });
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
        await addSpaceCollaborator(spaceId, {
          collaborators: userCollaborators,
          role: role as IBaseRole,
        });
      }
      if (departmentCollaborators.length > 0) {
        await addSpaceCollaborator(spaceId, {
          collaborators: departmentCollaborators,
          role: role as IBaseRole,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.spaceCollaboratorList(spaceId) });
      onClose();
      toast.success(t('invite.sendInvitationSuccess'));
    },
  });

  const defaultRole = userRole === Role.Owner ? Role.Creator : userRole;
  const linkListCount = linkList?.length || 0;
  const onBack = () => setTabType(undefined);
  const filteredRoleStatic = useFilteredRoleStatic(userRole);
  const baseFilteredRoleStatic = useFilteredBaseRoleStatic(defaultRole);

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
            spaceId,
            createSpaceInvitationLinkRo: { role: role as IBaseRole },
          })
        }
        onUpdate={(invitationId, role) =>
          updateInviteLink({
            invitationId,
            updateSpaceInvitationLinkRo: { role: role as IBaseRole },
            spaceId,
          })
        }
        onDelete={(invitationId) => deleteInviteLink({ invitationId, spaceId })}
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
        onCreate={(ro) => emailInvitation({ spaceId, emailSpaceInvitationRo: ro })}
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
      canUpdateRole: canOperator,
      canDelete: canOperator,
      showDelete: canOperator,
    };
  };

  const getFilteredRoleStatic = (item: CollaboratorItem) => {
    return item.resourceType === CollaboratorType.Base
      ? baseFilteredRoleStatic
      : filteredRoleStatic;
  };

  return (
    <div className="flex flex-col gap-4">
      <ShareHeader
        title={t('invite.dialog.title', { spaceName })}
        description={
          <Trans
            ns="common"
            i18nKey={'invite.dialog.desc'}
            count={total}
            components={{ b: <b /> }}
          />
        }
      />
      <div className="flex flex-col gap-5">
        <InviteEmailButton onClick={() => setTabType('email')} />
        {user?.organization && (
          <div className="space-y-2">
            <p className="text-sm font-semibold">{t('invite.addOrgCollaborator.title')}</p>
            <InviteOrgButton onClick={() => setTabType('organization')} />
          </div>
        )}
        {hasInviteLinkPermission && (
          <div className="space-y-2">
            <p className="text-sm font-semibold">{t('invite.dialog.tabLink')}</p>
            <InviteLinkButton
              className="box-content -translate-x-2 bg-transparent px-2 py-0"
              linkListCount={linkListCount}
              onClick={() => setTabType('link')}
            />
          </div>
        )}
        <div className="space-y-2">
          <p className="text-sm font-semibold">{t('invite.dialog.spaceTitle')}</p>
          <CollaboratorsDialog
            title={t('invite.dialog.spaceTitleWithCount', { count: total })}
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
                  getFilteredRoleStatic={getFilteredRoleStatic}
                  onUpdateRole={(role, item) => {
                    updateCollaborator({
                      resourceId: item.base?.id || spaceId,
                      isBase: item.resourceType === CollaboratorType.Base,
                      updateCollaborateRo: {
                        principalId:
                          item.type === PrincipalType.User ? item.userId : item.departmentId,
                        principalType: item.type,
                        role,
                      },
                    });
                  }}
                  onDelete={(item) => {
                    deleteCollaborator({
                      resourceId: item.base?.id || spaceId,
                      isBase: item.resourceType === CollaboratorType.Base,
                      principalId:
                        item.type === PrincipalType.User ? item.userId : item.departmentId,
                      principalType: item.type,
                    });
                  }}
                  getPermissions={getPermissions}
                  renderTips={(item) => {
                    return (
                      item.resourceType === CollaboratorType.Base &&
                      item.base?.name && (
                        <Badge className="ml-2 text-xs font-normal" variant={'outline'}>
                          {item.base.name}
                        </Badge>
                      )
                    );
                  }}
                />
              </div>
            }
          >
            <CollaboratorButton
              className="box-content -translate-x-2 px-2 py-0"
              collaborators={collaborators?.slice(0, 4) || []}
              total={total}
              onClick={() => setTabType('collaborators')}
            />
          </CollaboratorsDialog>
        </div>
      </div>
    </div>
  );
};
