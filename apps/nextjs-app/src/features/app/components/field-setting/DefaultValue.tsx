import { Label, Button } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import React from 'react';
import { tableConfig } from '@/features/i18n/table.config';

export const DefaultValue = (props: { children: React.ReactNode; onReset?: () => void }) => {
  const { children, onReset } = props;
  const { t } = useTranslation(tableConfig.i18nNamespaces);

  return (
    <div className="flex w-full flex-col  gap-2">
      <div className="flex w-full justify-between">
        <Label className="flex items-center text-sm font-medium">
          {t('table:field.editor.defaultValue')}
        </Label>
        {onReset && (
          <Button
            size="xs"
            variant="link"
            onClick={() => {
              onReset();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                onReset();
              }
            }}
            className="h-5 text-xs text-muted-foreground decoration-muted-foreground"
          >
            {t('table:field.editor.reset')}
          </Button>
        )}
      </div>
      {children}
    </div>
  );
};
