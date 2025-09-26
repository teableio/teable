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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib/shadcn';
import { PencilIcon, PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkFlowPanelStore } from '@/features/app/automation/workflow-panel/useWorkFlowPaneStore';
import { useBaseUsage } from '@/features/app/hooks/useBaseUsage';
import { tableConfig } from '@/features/i18n/table.config';
import { ColorPicker } from './SelectOptions';

const AutomationTooltip = (props: { children: React.ReactNode }) => {
  const { children } = props;
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent>
          <p className="max-w-[320px]">{t('billing.automationRequiresUpgrade')}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

const WorkflowAction = (props: { options?: Partial<IButtonFieldOptions>; onSave?: () => void }) => {
  const { options, onSave } = props;
  const workflow = options?.workflow;
  const { setModal } = useWorkFlowPanelStore();
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const usage = useBaseUsage();
  const { automationEnable = false } = usage?.limit ?? {};

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-sm font-medium">{t('table:field.default.button.automation')}</Label>
      {automationEnable ? (
        <Button
          className="flex items-center "
          variant="outline"
          onClick={() => {
            setModal({ from: 'buttonFieldOptions' });
            onSave?.();
          }}
        >
          {workflow?.id ? <PencilIcon className="size-4" /> : <PlusIcon className="size-4" />}
          <span className="flex-1 text-left">
            {workflow?.name || t('table:field.default.button.customAutomation')}
          </span>
        </Button>
      ) : (
        <AutomationTooltip>
          <Button className="flex items-center " variant="outline">
            <PlusIcon className="size-4" />
            <span className="flex-1 text-left">
              {workflow?.name || t('table:field.default.button.customAutomation')}
            </span>
          </Button>
        </AutomationTooltip>
      )}
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
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const bgColor = ColorUtils.getHexForColor(options?.color ?? Colors.Teal);
  const [limitClickCount, setLimitClickCount] = useState<boolean>((options?.maxCount ?? 0) > 0);

  return (
    <div className="form-control space-y-4 border-t pt-4">
      {!isLookup && (
        <div className="flex w-full flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label className="text-sm font-medium">{t('table:field.default.button.label')}</Label>

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
                className="h-9 flex-1"
                value={options?.label ?? '123'}
                onChange={(e) => onChange?.({ ...options, label: e.target.value })}
              />
            </div>
          </div>

          <WorkflowAction options={options} onSave={onSave} />

          <div className="flex flex-col gap-2">
            <div className="flex h-8 items-center gap-2">
              <Switch
                checked={limitClickCount}
                onCheckedChange={(checked) => {
                  setLimitClickCount(checked);
                  onChange?.({ ...options, maxCount: checked ? 1 : 0 });
                }}
              />
              <Label className="text-sm font-normal">
                {t('table:field.default.button.limitCount')}
              </Label>
            </div>

            {limitClickCount && (
              <div className="flex h-8 items-center gap-2">
                <Switch
                  checked={Boolean(options?.resetCount)}
                  onCheckedChange={(checked) => onChange?.({ ...options, resetCount: checked })}
                />
                <Label className="text-sm font-normal">
                  {t('table:field.default.button.resetCount')}
                </Label>
              </div>
            )}

            {limitClickCount && (
              <div className="flex flex-col gap-2">
                <Label className="font-mediun text-sm">
                  {t('table:field.default.button.maxCount')}
                </Label>
                <Input
                  className="h-8"
                  type="number"
                  value={options?.maxCount}
                  onChange={(e) =>
                    onChange?.({ ...options, maxCount: Math.max(0, Number(e.target.value)) })
                  }
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
