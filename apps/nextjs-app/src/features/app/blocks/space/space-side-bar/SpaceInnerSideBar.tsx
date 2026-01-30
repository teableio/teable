import { useMutation, useQuery } from '@tanstack/react-query';
import { getUniqName, hasPermission } from '@teable/core';
import { Plus, Settings, Trash2, LayoutTemplate } from '@teable/icons';
import { createBase, getSpaceById } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { cn } from '@teable/ui-lib/shadcn';
import { Button } from '@teable/ui-lib/shadcn/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib/shadcn/ui/tooltip';
import { useParams } from 'next/navigation';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { SpaceInnerTrashModal } from '@/features/app/blocks/trash/SpaceInnerTrashModal';
import { TemplateModal } from '@/features/app/components/space/template';
import { TemplateContext } from '@/features/app/components/space/template/context';
import { spaceConfig } from '@/features/i18n/space.config';
import { useBaseList } from '../useBaseList';
import { PinList } from './PinList';

export const SpaceInnerSideBar = (props: {
  renderSettingModal?: (children: React.ReactNode) => React.ReactNode;
  renderWinFreeCredit?: (spaceId: string) => React.ReactNode;
}) => {
  const { renderSettingModal, renderWinFreeCredit } = props;
  const router = useRouter();
  const { t } = useTranslation(spaceConfig.i18nNamespaces);
  const { spaceId } = useParams<{ spaceId: string }>();

  const { data: space } = useQuery({
    queryKey: ReactQueryKeys.space(spaceId),
    queryFn: ({ queryKey }) => getSpaceById(queryKey[1]).then((res) => res.data),
    enabled: !!spaceId,
  });

  const allBases = useBaseList();
  const bases = allBases?.filter((base) => base.spaceId === spaceId);

  const { mutate: createBaseMutator, isPending: createBaseLoading } = useMutation({
    mutationFn: createBase,
    onSuccess: ({ data }) => {
      router.push({
        pathname: '/base/[baseId]',
        query: { baseId: data.id },
      });
    },
  });

  const handleCreateBase = () => {
    if (!spaceId) return;
    const name = getUniqName(t('common:noun.base'), bases?.map((base) => base.name) || []);
    createBaseMutator({ spaceId, name });
  };

  const canCreateBase = space && hasPermission(space?.role, 'base|create');
  const canUpdateSpace = space && hasPermission(space.role, 'space|update');

  return (
    <>
      <div className="flex flex-col justify-center px-2">
        {space && (
          <div className="p-2">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="w-full">
                    <Button
                      variant={'outline'}
                      size={'sm'}
                      className="w-full"
                      disabled={!canCreateBase || createBaseLoading}
                      onClick={handleCreateBase}
                    >
                      <Plus className="size-4 shrink-0" />
                      {t('space:action.createBase')}
                    </Button>
                  </span>
                </TooltipTrigger>
                {!canCreateBase && (
                  <TooltipContent>{t('space:tooltip.noPermissionToCreateBase')}</TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
          </div>
        )}
        <ul className="py-1">
          {canUpdateSpace && renderSettingModal && (
            <li key="settings">
              {renderSettingModal(
                <Button
                  variant="ghost"
                  size={'xs'}
                  className={cn('w-full justify-start h-8 text-sm font-normal')}
                >
                  <Settings className="size-4 shrink-0" />
                  <p className="truncate">{t('space:spaceSetting.title')}</p>
                </Button>
              )}
            </li>
          )}
          <li key="trash">
            <SpaceInnerTrashModal spaceId={spaceId}>
              <Button
                variant="ghost"
                size={'xs'}
                className={cn('w-full justify-start h-8 text-sm font-normal')}
              >
                <Trash2 className="size-4 shrink-0" />
                <p className="truncate">{t('noun.trash')}</p>
              </Button>
            </SpaceInnerTrashModal>
          </li>
          <li key="template">
            <TemplateContext.Provider value={{ spaceId }}>
              <TemplateModal spaceId={spaceId}>
                <Button
                  variant="ghost"
                  size={'xs'}
                  className={cn('w-full justify-start h-8 text-sm font-normal')}
                >
                  <LayoutTemplate className="size-4 shrink-0" />
                  <p className="truncate">{t('common:noun.template')}</p>
                </Button>
              </TemplateModal>
            </TemplateContext.Provider>
          </li>
        </ul>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <PinList />
      </div>
      {renderWinFreeCredit && renderWinFreeCredit(spaceId)}
    </>
  );
};
