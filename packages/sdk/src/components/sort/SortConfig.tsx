import { Button, Label, Spin, Switch } from '@teable/ui-lib';
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

  return (
    <footer className="flex h-9 items-center justify-between border-t border-border-high bg-muted px-4 dark:bg-secondary">
      <div className="flex items-center space-x-2">
        <Switch
          id="airplane-mode"
          size="sm"
          onCheckedChange={(checked) => onChange?.(!checked)}
          checked={!value}
        />
        <Label htmlFor="airplane-mode" className="cursor-pointer text-sm font-normal">
          {t('sort.autoSort')}
        </Label>
      </div>

      {value && (
        <div className="flex items-center justify-between">
          <Button size="xs" disabled={buttonLoading} className="ml-2 h-6 text-xs" onClick={onClick}>
            {buttonLoading ? <Spin className="mr-1 size-4" /> : null}
            {t('sort.label')}
          </Button>
        </div>
      )}
    </footer>
  );
};
