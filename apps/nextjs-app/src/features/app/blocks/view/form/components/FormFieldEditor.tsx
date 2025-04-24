/* eslint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */
import { DraggableHandle, EyeOff } from '@teable/icons';
import { CellEditor } from '@teable/sdk/components';
import { useFieldStaticGetter, useTableId, useView } from '@teable/sdk/hooks';
import type { FormView, IFieldInstance } from '@teable/sdk/model';
import {
  Label,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import type { FC } from 'react';
import { tableConfig } from '@/features/i18n/table.config';

interface IFormFieldEditorProps {
  field: IFieldInstance;
}

export const FormFieldEditor: FC<IFormFieldEditorProps> = (props) => {
  const { field } = props;
  const view = useView() as FormView | undefined;
  const tableId = useTableId();
  const getFieldStatic = useFieldStaticGetter();
  const { t } = useTranslation(tableConfig.i18nNamespaces);

  if (!view || !tableId) return null;

  const { type, name, description, isComputed, isLookup, id: fieldId, aiConfig } = field;
  const Icon = getFieldStatic(type, {
    isLookup,
    hasAiConfig: Boolean(aiConfig),
  }).Icon;

  const onHidden = (event: React.MouseEvent<SVGSVGElement, MouseEvent>) => {
    event.stopPropagation();
    view.updateColumnMeta([
      {
        fieldId: fieldId,
        columnMeta: {
          visible: false,
        },
      },
    ]);
  };

  const onRequiredChange = (checked: boolean) => {
    view.updateColumnMeta([
      {
        fieldId: fieldId,
        columnMeta: {
          required: checked,
        },
      },
    ]);
  };

  const required = field.notNull || view.columnMeta[fieldId]?.required;

  return (
    <div className="relative w-full px-8 py-5">
      <div className="mb-2 flex w-full items-center justify-between">
        <div className="flex overflow-hidden">
          <div className="flex h-6 shrink-0 items-center">
            <Icon className="size-4 shrink-0" />
          </div>
          <h3 className="mx-1">{name}</h3>
        </div>
        <div className="flex items-center">
          {!isComputed && (
            <div className="flex shrink-0 items-center" onClick={(e) => e.stopPropagation()}>
              <Label htmlFor="form-field-required">{t('required')}</Label>
              <Switch
                id="form-field-required"
                className="ml-1 mr-2"
                checked={required}
                disabled={field.notNull}
                onCheckedChange={onRequiredChange}
              />
            </div>
          )}
          <TooltipProvider>
            <Tooltip delayDuration={200}>
              <TooltipTrigger asChild>
                <span>
                  <EyeOff
                    className="size-6 cursor-pointer rounded p-1 hover:bg-slate-300 dark:hover:bg-slate-600"
                    onClick={onHidden}
                  />
                </span>
              </TooltipTrigger>
              <TooltipContent sideOffset={8}>{t('table:form.removeFromFormTip')}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
      {description && <div className="mb-2 text-xs text-slate-400">{description}</div>}
      <CellEditor field={field} wrapClassName="pointer-events-none" />
      {required && <span className="absolute left-[22px] top-5 text-red-500">*</span>}
      <DraggableHandle className="absolute left-1 top-6" />
    </div>
  );
};
