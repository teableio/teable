/* eslint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */
import { DraggableHandle, EyeOff } from '@teable-group/icons';
import { CellEditor } from '@teable-group/sdk/components';
import { useFieldStaticGetter, useTableId, useView } from '@teable-group/sdk/hooks';
import type { IFieldInstance } from '@teable-group/sdk/model';
import {
  Label,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable-group/ui-lib/shadcn';
import type { FC } from 'react';

interface IFormFieldEditorProps {
  field: IFieldInstance;
}

export const FormFieldEditor: FC<IFormFieldEditorProps> = (props) => {
  const { field } = props;
  const view = useView();
  const tableId = useTableId();
  const getFieldStatic = useFieldStaticGetter();

  if (!view || !tableId) return null;

  const { type, name, description, isComputed, isLookup, id: fieldId } = field;
  const Icon = getFieldStatic(type, isLookup).Icon;

  const onHidden = (event: React.MouseEvent<SVGSVGElement, MouseEvent>) => {
    event.stopPropagation();
    view.setViewColumnMeta([
      {
        fieldId: fieldId,
        columnMeta: {
          hidden: true,
        },
      },
    ]);
  };

  const onRequiredChange = (checked: boolean) => {
    view.setViewColumnMeta([
      {
        fieldId: fieldId,
        columnMeta: {
          required: checked,
        },
      },
    ]);
  };

  const required = view.columnMeta[fieldId]?.required;

  return (
    <div className="relative w-full px-8 py-5">
      <div className="mb-2 flex w-full items-center justify-between">
        <div className="flex items-center overflow-hidden">
          <Icon className="shrink-0" />
          <h3 className="mx-1 truncate">{name}</h3>
        </div>
        <div className="flex items-center">
          {!isComputed && (
            <div className="flex items-center" onClick={(e) => e.stopPropagation()}>
              <Label htmlFor="form-field-required">Required</Label>
              <Switch
                id="form-field-required"
                className="ml-1 mr-2"
                checked={required}
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
              <TooltipContent sideOffset={8}>Remove from the form</TooltipContent>
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
