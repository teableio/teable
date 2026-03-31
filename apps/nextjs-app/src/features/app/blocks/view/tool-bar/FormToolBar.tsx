import { ArrowUpRight, Settings as Edit, Edit as Fill } from '@teable/icons';
import { useTableId, useTablePermission, useView, useViewId } from '@teable/sdk/hooks';
import { Tabs, TabsList, TabsTrigger } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useMemo, useState } from 'react';
import { useBaseNodeContext } from '@/features/app/blocks/base/base-node/hooks/useBaseNodeContext';
import { useSharedNodeIds } from '@/features/app/blocks/base/base-side-bar/BaseNodeShareIndicator';
import { tableConfig } from '@/features/i18n/table.config';
import { generateUniqLocalKey } from '../form/util';
import { FormMode, useFormModeStore } from './store';
import { ToolBarButton } from './ToolBarButton';
import { UnifiedShareDialog } from './UnifiedShareDialog';

const FormShareButton = ({ disabled }: { disabled: boolean }) => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const view = useView();
  const tableId = useTableId();
  const { treeItems } = useBaseNodeContext();
  const sharedNodeIds = useSharedNodeIds();
  const [open, setOpen] = useState(false);

  const isNodeShared = useMemo(() => {
    if (!tableId) return false;
    const entry = Object.entries(treeItems).find(([, item]) => item.resourceId === tableId);
    return entry ? sharedNodeIds.has(entry[0]) : false;
  }, [tableId, treeItems, sharedNodeIds]);

  const isActive = !!view?.enableShare || isNodeShared;
  const text = t('table:toolbar.others.share.label');

  return (
    <>
      <ToolBarButton
        isActive={isActive}
        text={text}
        textClassName="inline"
        className="justify-start"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <ArrowUpRight className="size-4" />
      </ToolBarButton>
      <UnifiedShareDialog open={open} onOpenChange={setOpen} />
    </>
  );
};

export const FormToolBar: React.FC = () => {
  const tableId = useTableId();
  const currentViewId = useViewId();
  const { modeMap, setModeMap } = useFormModeStore();
  const modeKey = generateUniqLocalKey(tableId, currentViewId);
  const currentMode = modeMap[modeKey] ?? FormMode.Edit;
  const permission = useTablePermission();
  const isEditable = permission['view|update'];
  const { t } = useTranslation(tableConfig.i18nNamespaces);

  const setFormMode = (mode: FormMode) => {
    if (!tableId || !currentViewId) return;

    setModeMap(modeKey, mode);
  };

  const FORM_MODE_BUTTON_LIST = useMemo(
    () => [
      {
        text: t('actions.edit'),
        Icon: Edit,
        mode: FormMode.Edit,
      },
      {
        text: t('actions.fill'),
        Icon: Fill,
        mode: FormMode.Fill,
      },
    ],
    [t]
  );

  return (
    <div className="flex flex-wrap items-center justify-end border-y px-4 py-2 @container/toolbar sm:justify-between">
      <div className="hidden flex-1 sm:flex">
        {isEditable && (
          <Tabs size="sm" value={currentMode} onValueChange={(v) => setFormMode(v as FormMode)}>
            <TabsList>
              {FORM_MODE_BUTTON_LIST.map((item) => {
                const { text, Icon, mode } = item;
                return (
                  <TabsTrigger key={mode} value={mode} className="w-20 gap-1">
                    <Icon className="size-4" />
                    {text}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </Tabs>
        )}
      </div>

      <FormShareButton disabled={!permission['view|update']} />
    </div>
  );
};
