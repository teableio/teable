import { FieldType } from '@teable/core';
import { Settings } from '@teable/icons';
import type { EditorView } from '@teable/sdk';
import { useFields, useFieldStaticGetter, useView } from '@teable/sdk/hooks';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { tableConfig } from '@/features/i18n/table.config';
import { ToolBarButton } from '../ToolBarButton';

export const EditorViewOperators: React.FC<{ disabled?: boolean }> = (props) => {
  const { disabled } = props;
  const view = useView() as EditorView | undefined;
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const fields = useFields({ withHidden: true, withDenied: true });
  const fieldStaticGetter = useFieldStaticGetter();

  const { editorFieldId } = view?.options ?? {};

  const longTextFields = useMemo(
    () => fields.filter((field) => field.type === FieldType.LongText),
    [fields]
  );

  const onFieldChange = (fieldId: string) => {
    view?.updateOption({ editorFieldId: fieldId });
  };

  if (!view) return null;

  return (
    <div className="flex items-center gap-1">
      <Popover modal>
        <PopoverTrigger asChild>
          <ToolBarButton
            disabled={disabled}
            isActive={false}
            text={t('table:editor.toolbar.settings')}
            textClassName="@2xl/toolbar:inline"
          >
            <Settings className="size-4 text-sm" />
          </ToolBarButton>
        </PopoverTrigger>
        <PopoverContent side="bottom" align="start" className="flex w-[272px] flex-col gap-4 p-4">
          {longTextFields.length > 0 ? (
            <div className="flex flex-col gap-2">
              <span className="text-xs text-muted-foreground">
                {t('table:editor.toolbar.editorField')}
              </span>
              <Select value={editorFieldId ?? undefined} onValueChange={onFieldChange}>
                <SelectTrigger className="h-8 w-full bg-background">
                  <SelectValue placeholder={t('table:editor.toolbar.selectField')} />
                </SelectTrigger>
                <SelectContent className="w-full">
                  {longTextFields.map(({ id, type, name, isLookup, isConditionalLookup, aiConfig }) => {
                    const { Icon } = fieldStaticGetter(type, {
                      isLookup,
                      isConditionalLookup,
                      hasAiConfig: Boolean(aiConfig),
                    });
                    return (
                      <SelectItem key={id} value={id}>
                        <div className="flex flex-row items-center text-[13px]">
                          <Icon className="size-5 shrink-0 pr-1" />
                          {name}
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">
              {t('table:editor.toolbar.noLongTextFields')}
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
};
