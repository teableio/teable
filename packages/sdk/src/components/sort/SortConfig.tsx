import { Button, Label, Spin, Switch } from '@teable/ui-lib';
import { useId } from 'react';
import { useTranslation } from '../../context/app/i18n';

interface ISortConfigProps {
  value?: boolean;
  buttonLoading?: boolean;
  onClick?: () => void;
  onChange?: (checked: boolean) => void;
}

export const SortConfig = (props: ISortConfigProps) => {
  const { value, buttonLoading, onClick, onChange } = props;
  const { t } = useTranslation();
  // The popover and the drawer can both be mounted across a breakpoint
  // change; a hard-coded id would tie one panel's label to the other's switch.
  const switchId = useId();

  return (
    <footer className="flex min-h-12 items-center justify-between gap-2 border-t border-border-high bg-muted px-4 py-2 dark:bg-secondary">
      <div className="flex min-w-0 flex-1 items-center space-x-2 rtl:space-x-reverse">
        <Switch
          id={switchId}
          size="sm"
          onCheckedChange={(checked) => onChange?.(!checked)}
          checked={!value}
        />
        <Label htmlFor={switchId} className="cursor-pointer truncate text-sm font-normal">
          {t('sort.autoSort')}
        </Label>
      </div>

      {value && (
        <div className="flex shrink-0 items-center justify-between">
          <Button size="xs" disabled={buttonLoading} className="ms-2 h-6" onClick={onClick}>
            {buttonLoading ? <Spin className="me-1 size-4" /> : null}
            {t('sort.label')}
          </Button>
        </div>
      )}
    </footer>
  );
};
