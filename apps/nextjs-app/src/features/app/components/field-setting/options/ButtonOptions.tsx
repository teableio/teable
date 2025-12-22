import { Colors, ColorUtils, FieldType } from '@teable/core';
import type { IButtonFieldOptions } from '@teable/core';
import { Plus } from '@teable/icons';
import { FieldSelector } from '@teable/sdk/components';
import { useFields } from '@teable/sdk/hooks';
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
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkFlowPanelStore } from '@/features/app/automation/workflow-panel/useWorkFlowPaneStore';
import { useBaseUsage } from '@/features/app/hooks/useBaseUsage';
import { tableConfig } from '@/features/i18n/table.config';
import { PromptEditor, type EditorViewRef } from '../field-ai-config/components/prompt-editor';
import { ColorPicker } from './SelectOptions';

const UnavailableInPlanTips = (props: { children: React.ReactNode }) => {
  const { children } = props;
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent>
          <p className="max-w-[320px]">{t('billing.unavailableInPlanTips')}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

const ConfirmEditor = (props: {
  options?: Partial<IButtonFieldOptions>;
  onChange?: (options: Partial<IButtonFieldOptions>) => void;
}) => {
  const { options, onChange } = props;
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const fields = useFields({ withHidden: true, withDenied: true });
  const titleEditorViewRef = useRef(null) as EditorViewRef;
  const descEditorViewRef = useRef(null) as EditorViewRef;
  const confirmTextEditorViewRef = useRef(null) as EditorViewRef;
  const confirmEnabled = Boolean(options?.confirm);
  const confirm = options?.confirm;

  const excludedFieldIds = useMemo(() => {
    return fields.filter((field) => field.type === FieldType.Attachment).map((field) => field.id);
  }, [fields]);

  const onFieldSelect = (fieldId: string, editorViewRef: EditorViewRef) => {
    const formatValue = `{${fieldId}}`;
    const view = editorViewRef.current;

    if (view) {
      const { from, to } = view.state.selection.main;
      view.dispatch({
        changes: { from, to, insert: formatValue },
        selection: { anchor: from + formatValue.length },
      });
      view.focus();
    }
  };

  const updateConfirm = (key: keyof NonNullable<typeof confirm>, value: string) => {
    onChange?.({
      ...options,
      confirm: {
        ...confirm,
        [key]: value,
      },
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-8 items-center gap-2">
        <Switch
          checked={confirmEnabled}
          onCheckedChange={(checked) => {
            onChange?.({
              ...options,
              confirm: checked ? { title: '', description: '', confirmText: '' } : null,
            });
          }}
        />
        <Label className="text-sm font-normal">
          {t('table:field.default.button.clickConfirm')}
        </Label>
      </div>

      {confirmEnabled && (
        <div className="flex flex-col gap-2 rounded-md border-muted bg-muted p-3">
          {/* Title */}
          <div className="flex flex-col gap-1">
            <div className="flex h-6 items-center justify-between">
              <Label className="text-xs text-muted-foreground">
                {t('table:field.default.button.confirmTitle')}
              </Label>
              <FieldSelector
                excludedIds={excludedFieldIds}
                onSelect={(fieldId) => onFieldSelect(fieldId, titleEditorViewRef)}
                modal
              >
                <Button variant="ghost" size="xs">
                  <Plus className="size-4" />
                </Button>
              </FieldSelector>
            </div>
            <PromptEditor
              themeOptions={{ height: 'auto', content: { padding: '6px 0px' } }}
              value={confirm?.title ?? ''}
              placeholder={t('sdk:field.button.confirm.title')}
              editorViewRef={titleEditorViewRef}
              onChange={(value) => updateConfirm('title', value)}
            />
          </div>

          {/* Description */}
          <div className="flex flex-col gap-1">
            <div className="flex h-6 items-center justify-between">
              <Label className="text-xs text-muted-foreground">
                {t('table:field.default.button.confirmDescription')}
              </Label>
              <FieldSelector
                excludedIds={excludedFieldIds}
                onSelect={(fieldId) => onFieldSelect(fieldId, descEditorViewRef)}
                modal
              >
                <Button variant="ghost" size="xs">
                  <Plus className="size-4" />
                </Button>
              </FieldSelector>
            </div>
            <PromptEditor
              themeOptions={{ content: { padding: '6px 0px' } }}
              value={confirm?.description ?? ''}
              placeholder={t('sdk:field.button.confirm.description')}
              editorViewRef={descEditorViewRef}
              onChange={(value) => updateConfirm('description', value)}
            />
          </div>

          {/* Confirm Button Text */}
          <div className="flex flex-col gap-1">
            <div className="flex h-6 items-center justify-between">
              <Label className="text-xs text-muted-foreground">
                {t('table:field.default.button.confirmButtonText')}
              </Label>
            </div>
            <PromptEditor
              themeOptions={{ height: 'auto', content: { padding: '6px 0px' } }}
              value={confirm?.confirmText ?? ''}
              placeholder={t('common:actions.confirm')}
              editorViewRef={confirmTextEditorViewRef}
              onChange={(value) => updateConfirm('confirmText', value)}
            />
          </div>
        </div>
      )}
    </div>
  );
};

const WorkflowAction = (props: { options?: Partial<IButtonFieldOptions>; onSave?: () => void }) => {
  const { options, onSave } = props;
  const workflow = options?.workflow;
  const { setModal } = useWorkFlowPanelStore();
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const usage = useBaseUsage();
  const { buttonFieldEnable = false } = usage?.limit ?? {};

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-sm font-medium">{t('table:field.default.button.automation')}</Label>
      {buttonFieldEnable ? (
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
        <UnavailableInPlanTips>
          <Button className="flex items-center " variant="outline">
            <PlusIcon className="size-4" />
            <span className="flex-1 text-left">
              {workflow?.name || t('table:field.default.button.customAutomation')}
            </span>
          </Button>
        </UnavailableInPlanTips>
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

            <ConfirmEditor options={options} onChange={onChange} />
          </div>
        </div>
      )}
    </div>
  );
};
