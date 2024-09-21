import { Label } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import React from 'react';
import { tableConfig } from '@/features/i18n/table.config';

export const DefaultValue = (props: { children: React.ReactNode; onReset?: () => void }) => {
  const { children, onReset } = props;
  const { t } = useTranslation(tableConfig.i18nNamespaces);

  return (
    <div className="flex w-full flex-col gap-2">
      <Label className="flex justify-between font-normal">
        {t('table:field.editor.defaultValue')}
        {onReset && (
          <span
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                onReset();
              }
            }}
            onClick={() => onReset()}
            tabIndex={0}
            role={'button'}
            className="cursor-pointer border-b border-solid border-slate-500 text-xs text-slate-500"
          >
            {t('table:field.editor.reset')}
          </span>
        )}
      </Label>
      {children}
    </div>
  );
};
