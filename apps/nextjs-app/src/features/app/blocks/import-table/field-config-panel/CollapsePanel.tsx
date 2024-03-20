import { ChevronRight } from '@teable/icons';
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Switch,
} from '@teable/ui-lib';
import classNames from 'classnames';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import type { ITableImportOptions } from '../TableImport';

interface ICollapsePanel {
  onChange: (value: boolean, propertyName: keyof ITableImportOptions) => void;
  options: ITableImportOptions;
}

export const CollapsePanel = (props: ICollapsePanel) => {
  const [open, setOpen] = useState(false);
  const { options, onChange } = props;
  const { t } = useTranslation(['table']);

  return (
    <Collapsible
      open={open}
      onOpenChange={(open) => setOpen(open)}
      className={classNames('w-full rounded-sm')}
    >
      <CollapsibleTrigger className="w-full" asChild>
        <Button variant="ghost" className="flex w-full justify-start">
          <ChevronRight
            className={classNames('h-4 w-4 transition', open ? 'rotate-90' : 'rotate-0')}
          />
          {t('table:import.title.optionsTitle')}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col items-start">
        <label
          htmlFor="autoSelectType"
          className="flex w-56 cursor-pointer items-center rounded p-2 text-sm hover:bg-accent"
        >
          <Switch
            id="autoSelectType"
            checked={options.autoSelectType}
            onCheckedChange={(value) => onChange(value, 'autoSelectType')}
          />
          <span className="pl-2">{t('table:import.options.autoSelectFieldOptionName')}</span>
        </label>

        <label
          htmlFor="useFirstRowAsHeader"
          className="flex w-56 cursor-pointer items-center rounded p-2 text-sm hover:bg-accent"
        >
          <Switch
            id="useFirstRowAsHeader"
            checked={options.useFirstRowAsHeader}
            onCheckedChange={(value) => onChange(value, 'useFirstRowAsHeader')}
          />
          <span className="pl-2">{t('table:import.options.useFirstRowAsHeaderOptionName')}</span>
        </label>

        <label
          htmlFor="importData"
          className="flex w-56 cursor-pointer items-center rounded p-2 text-sm hover:bg-accent"
        >
          <Switch
            id="importData"
            checked={options.importData}
            onCheckedChange={(value) => onChange(value, 'importData')}
          />
          <span className="pl-2">{t('table:import.options.importDataOptionName')}</span>
        </label>
      </CollapsibleContent>
    </Collapsible>
  );
};
