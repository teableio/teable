import { Colors, ColorUtils } from '@teable/core';
import type { IButtonFieldOptions } from '@teable/core';
import {
  Button,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Switch,
} from '@teable/ui-lib/shadcn';
import { PencilIcon, PlusIcon } from 'lucide-react';
import { useWorkFlowPanelStore } from '@/features/app/automation/workflow-panel/useWorkFlowPaneStore';
import { ColorPicker } from './SelectOptions';

const WorkflowAction = (props: { options?: Partial<IButtonFieldOptions>; onSave?: () => void }) => {
  const { options, onSave } = props;
  const workflow = options?.workflow;
  const { setModal } = useWorkFlowPanelStore();

  return (
    <div className="flex flex-col gap-2">
      <Label className="font-normal">Workflow</Label>
      <Input className="h-8 flex-1" placeholder="workflow-id to be hidden" value={workflow?.id} />
      <Button
        className="flex items-center "
        variant="outline"
        onClick={() => {
          setModal({ from: 'buttonFieldOptions' });
          onSave?.();
        }}
      >
        {workflow?.id ? <PencilIcon className="size-4" /> : <PlusIcon className="size-4" />}
        <span className="flex-1 text-left">{workflow?.name || 'Custom Automation'}</span>
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
              className="h-8"
              type="number"
              value={options?.maxCount}
              onChange={(e) =>
                onChange?.({ ...options, maxCount: Math.max(0, Number(e.target.value)) })
              }
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label className="font-normal">Reset count</Label>
            <Switch
              checked={Boolean(options?.resetCount)}
              onCheckedChange={(checked) => onChange?.({ ...options, resetCount: checked })}
            />
          </div>

          <WorkflowAction options={options} onSave={onSave} />
        </div>
      )}
    </div>
  );
};
