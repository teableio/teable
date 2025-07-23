import { BUTTON_FIELD_TEMP_WORKFLOW_ID, Colors, ColorUtils } from '@teable/core';
import type { IButtonFieldOptions } from '@teable/core';
import {
  Button,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@teable/ui-lib/shadcn';
import { useCallback, useEffect, useRef } from 'react';
// import { flushSync } from 'react-dom'; // 备选方案2：使用flushSync
import { ColorPicker } from './SelectOptions';

const WorkflowAction = (props: {
  options: Partial<IButtonFieldOptions>;
  workflowId?: string;
  onChange?: (options: Partial<IButtonFieldOptions>) => void;
  onSave?: () => void;
}) => {
  const { workflowId, onChange, onSave, options } = props;
  const shouldSaveRef = useRef(false);

  console.log('fixme uno workflowId - 1', workflowId, options);

  useEffect(() => {
    if (shouldSaveRef.current) {
      shouldSaveRef.current = false;
      onSave?.();
    }
  }, [options, onSave]);

  const handleClick = useCallback(() => {
    shouldSaveRef.current = true;
    onChange?.({
      ...options,
      workflowId: workflowId ?? BUTTON_FIELD_TEMP_WORKFLOW_ID,
    });
    console.log('fixme uno workflowId - 2', workflowId, options);
  }, [onChange, options, workflowId]);

  return (
    <div className="flex flex-col gap-2">
      <Label className="font-normal">Workflow</Label>
      <Input className="h-8 flex-1" placeholder="workflow-id" value={workflowId} />
      <Button variant="outline" onClick={handleClick}>
        Custom Automation
      </Button>
    </div>
  );
};

export const ButtonOptions = (props: {
  options: Partial<IButtonFieldOptions> | undefined;
  onChange?: (options: Partial<IButtonFieldOptions>) => void;
  isLookup?: boolean;
  onSave?: () => void;
}) => {
  const { isLookup, options, onChange, onSave } = props;
  // console.log('fixme uno button options', fieldId, options);

  const bgColor = ColorUtils.getHexForColor(options?.color ?? Colors.Teal);

  return (
    <div className="form-control space-y-2">
      {!isLookup && (
        <div className="flex w-full flex-col gap-2">
          <div className="flex flex-col gap-2">
            <Label className="font-normal">Label</Label>

            <div className="flex items-center gap-2">
              <Popover>
                <PopoverTrigger>
                  <Button
                    variant={'ghost'}
                    className="h-auto rounded-full border-2 p-[2px]"
                    style={{ borderColor: bgColor }}
                  >
                    <div style={{ backgroundColor: bgColor }} className="size-3 rounded-full" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-2">
                  <ColorPicker
                    color={options?.color ?? Colors.Teal}
                    onSelect={(color) => onChange?.({ ...options, color })}
                  />
                </PopoverContent>
              </Popover>

              <Input
                className="h-8 flex-1"
                value={options?.label}
                onChange={(e) => onChange?.({ ...options, label: e.target.value })}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label className="font-normal">Max count</Label>
            <Input
              className="h-8 flex-1"
              type="number"
              value={options?.maxCount}
              onChange={(e) =>
                onChange?.({ ...options, maxCount: Math.max(0, Number(e.target.value)) })
              }
            />
          </div>

          <WorkflowAction
            options={options ?? {}}
            workflowId={options?.workflowId}
            onChange={onChange}
            onSave={onSave}
          />
        </div>
      )}
    </div>
  );
};
