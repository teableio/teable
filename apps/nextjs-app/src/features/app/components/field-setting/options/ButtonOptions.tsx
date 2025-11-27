import { Colors, ColorUtils } from '@teable/core';
import type { IButtonFieldOptions, FieldType } from '@teable/core';
import { useFieldStaticGetter } from '@teable/sdk';
import {
  Button,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib/shadcn';
import { ExternalLinkIcon, PencilIcon, PlusIcon } from 'lucide-react';
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

const OpenLinkAction = (props: {
  options?: Partial<IButtonFieldOptions>;
  onChange?: (options: Partial<IButtonFieldOptions>) => void;
  fields?: Array<{ id: string; name: string; type: string }>;
}) => {
  const { options, onChange, fields = [] } = props;
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const getFieldStatic = useFieldStaticGetter();
  const [urlMode, setUrlMode] = useState<'manual' | 'field'>(
    options?.url && options.url.startsWith('{') && options.url.endsWith('}') ? 'field' : 'manual'
  );

  // Filter for text and formula fields
  const textFields = fields.filter(
    (field) =>
      field.type === 'singleLineText' || field.type === 'formula' || field.type === 'longText'
  );

  const handleUrlChange = (value: string) => {
    onChange?.({ ...options, url: value });
  };

  const handleFieldSelect = (fieldId: string) => {
    onChange?.({ ...options, url: `{${fieldId}}` });
  };

  const currentFieldValue = options?.url;
  const selectedFieldId =
    currentFieldValue?.startsWith('{') && currentFieldValue.endsWith('}')
      ? currentFieldValue.slice(1, -1)
      : '';

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-sm font-medium">{t('table:field.default.button.linkUrl')}</Label>

      <div className="flex gap-2">
        <Select value={urlMode} onValueChange={(value: 'manual' | 'field') => setUrlMode(value)}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="manual">{t('table:field.default.button.manualUrl')}</SelectItem>
            <SelectItem value="field">{t('table:field.default.button.fieldUrl')}</SelectItem>
          </SelectContent>
        </Select>

        {urlMode === 'manual' ? (
          <Input
            placeholder="https://example.com"
            value={currentFieldValue && !currentFieldValue.startsWith('{') ? currentFieldValue : ''}
            onChange={(e) => handleUrlChange(e.target.value)}
            className="flex-1"
          />
        ) : (
          <Select
            value={selectedFieldId}
            onValueChange={handleFieldSelect}
            disabled={textFields.length === 0}
          >
            <SelectTrigger className="flex-1">
              <SelectValue
                placeholder={
                  textFields.length === 0
                    ? t('table:field.default.button.noTextFields')
                    : t('table:field.default.button.selectField')
                }
              >
                {selectedFieldId &&
                  (() => {
                    const selectedField = textFields.find((f) => f.id === selectedFieldId);
                    if (selectedField) {
                      const { Icon } = getFieldStatic(selectedField.type as FieldType, {
                        isLookup: false,
                        hasAiConfig: false,
                      });
                      return (
                        <div className="flex items-center gap-2">
                          <Icon className="size-4" />
                          <span>{selectedField.name}</span>
                        </div>
                      );
                    }
                    return null;
                  })()}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {textFields.map((field) => {
                const { Icon } = getFieldStatic(field.type as FieldType, {
                  isLookup: false,
                  hasAiConfig: false,
                });
                return (
                  <SelectItem key={field.id} value={field.id}>
                    <div className="flex items-center gap-2">
                      <Icon className="size-4" />
                      <span>{field.name}</span>
                    </div>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="flex h-8 items-center gap-2">
        <Switch
          checked={options?.openInNewTab ?? true}
          onCheckedChange={(checked) => onChange?.({ ...options, openInNewTab: checked })}
        />
        <Label className="text-sm font-normal">
          {t('table:field.default.button.openInNewTab')}
        </Label>
      </div>
    </div>
  );
};

export const ButtonOptions = (props: {
  options: Partial<IButtonFieldOptions> | undefined;
  onChange?: (options: Partial<IButtonFieldOptions>) => void;
  isLookup?: boolean;
  onSave?: () => void;
  fields?: Array<{ id: string; name: string; type: string }>;
}) => {
  const { isLookup, options, onChange, onSave, fields } = props;
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const bgColor = ColorUtils.getHexForColor(options?.color ?? Colors.Teal);
  const [limitClickCount, setLimitClickCount] = useState<boolean>((options?.maxCount ?? 0) > 0);
  const [action, setAction] = useState<'workflow' | 'openLink'>(options?.action || 'workflow');

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
                value={options?.label ?? 'Button'}
                onChange={(e) => onChange?.({ ...options, label: e.target.value })}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label className="text-sm font-medium">{t('table:field.default.button.action')}</Label>
            <Select
              value={action}
              onValueChange={(value: 'workflow' | 'openLink') => {
                setAction(value);
                onChange?.({
                  ...options,
                  action: value,
                  // Clear workflow when switching to openLink
                  ...(value === 'openLink' ? { workflow: undefined } : {}),
                });
              }}
            >
              <SelectTrigger>
                <SelectValue>
                  {action === 'workflow' ? (
                    <div className="flex items-center gap-2">
                      <PencilIcon className="size-4" />
                      {t('table:field.default.button.triggerWorkflow')}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <ExternalLinkIcon className="size-4" />
                      {t('table:field.default.button.openLink')}
                    </div>
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="workflow">
                  <div className="flex items-center gap-2">
                    <PencilIcon className="size-4" />
                    {t('table:field.default.button.triggerWorkflow')}
                  </div>
                </SelectItem>
                <SelectItem value="openLink">
                  <div className="flex items-center gap-2">
                    <ExternalLinkIcon className="size-4" />
                    {t('table:field.default.button.openLink')}
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {action === 'workflow' ? (
            <WorkflowAction options={options} onSave={onSave} />
          ) : (
            <OpenLinkAction options={options} onChange={onChange} fields={fields} />
          )}

          {/* Click count limit - only show for workflow action */}
          {action === 'workflow' && (
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
          )}
        </div>
      )}
    </div>
  );
};
