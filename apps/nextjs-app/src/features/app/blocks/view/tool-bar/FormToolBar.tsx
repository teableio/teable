import { ArrowUpRight, Settings as Edit, Edit as Fill } from '@teable/icons';
import { useTableId, useTablePermission, useViewId } from '@teable/sdk/hooks';
import { Button } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { tableConfig } from '@/features/i18n/table.config';
import { generateUniqLocalKey } from '../form/util';
import { SharePopover } from './SharePopover';
import { FormMode, useFormModeStore } from './store';
import { ToolBarButton } from './ToolBarButton';

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

      <SharePopover>
        {(text, isActive) => (
          <ToolBarButton
            isActive={isActive}
            text={text}
            textClassName="inline"
            className="justify-start rounded-none"
            disabled={!permission['view|update']}
          >
            <ArrowUpRight className="size-4" />
          </ToolBarButton>
        )}
      </SharePopover>
    </div>
  );
};
