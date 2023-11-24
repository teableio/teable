import { ArrowUpRight, Settings as Edit, Edit as Fill } from '@teable-group/icons';
import { useTableId, useTablePermission, useViewId } from '@teable-group/sdk/hooks';
import { Button } from '@teable-group/ui-lib/shadcn';
import { generateUniqLocalKey } from '../form/util';
import { SharePopover } from './SharePopover';
import { FormMode, useFormModeStore } from './store';
import { ToolBarButton } from './ToolBarButton';

const FORM_MODE_BUTTON_LIST = [
  {
    text: 'Edit',
    Icon: Edit,
    mode: FormMode.Edit,
  },
  {
    text: 'Fill',
    Icon: Fill,
    mode: FormMode.Fill,
  },
];

export const FormToolBar: React.FC = () => {
  const tableId = useTableId();
  const currentViewId = useViewId();
  const { modeMap, setModeMap } = useFormModeStore();
  const modeKey = generateUniqLocalKey(tableId, currentViewId);
  const currentMode = modeMap[modeKey] ?? FormMode.Edit;
  const permission = useTablePermission();
  const isEditable = permission['view|update'];

  const setFormMode = (mode: FormMode) => {
    if (!tableId || !currentViewId) return;

    setModeMap(modeKey, mode);
  };

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

      {/* <Button variant={'ghost'} size={'xs'} className="font-normal">
        <ArrowUpRight className="h-4 w-4" />
        Share
      </Button> */}
      <SharePopover>
        {(text, isActive) => (
          <ToolBarButton disabled={!isEditable} isActive={isActive} text={text}>
            <ArrowUpRight className="h-4 w-4" />
          </ToolBarButton>
        )}
      </SharePopover>
    </div>
  );
};
