import { ArrowUpRight, Settings as Edit, Edit as Fill } from '@teable/icons';
import { useTableId, useTablePermission, useView, useViewId } from '@teable/sdk/hooks';
import { Button } from '@teable/ui-lib/shadcn';
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
    <div className="flex flex-wrap items-center justify-end border-y py-2 pl-8 pr-4 @container/toolbar sm:justify-between">
      <div className="hidden flex-1 sm:flex">
        {isEditable &&
          FORM_MODE_BUTTON_LIST.map((item) => {
            const { text, Icon, mode } = item;
            return (
              <Button
                key={mode}
                variant={currentMode === mode ? 'default' : 'outline'}
                size={'xs'}
                className="mr-4 px-8 font-normal"
                onClick={() => setFormMode(mode)}
              >
                <Icon />
                {text}
              </Button>
            );
          })}
      </div>

      <FormShareButton disabled={!permission['view|update']} />
    </div>
  );
};
