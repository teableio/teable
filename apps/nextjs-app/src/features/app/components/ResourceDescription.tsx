import { getEditorMarkdown, MarkdownLongTextEditor, stripMarkdown } from '@teable/sdk/components';
import { Spin } from '@teable/ui-lib/base';
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

type DescriptionSaveStatus = 'idle' | 'saving' | 'error';

interface IResourceDescriptionDialogProps {
  description?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave?: (description: string | null) => Promise<void>;
  readOnly?: boolean;
  errorLogName?: string;
}

interface IResourceDescriptionProps {
  canUpdate: boolean;
  description?: string | null;
  onSave?: (description: string | null) => Promise<void>;
  fallback?: ReactNode;
  className?: string;
  readOnlyClassName?: string;
  fallbackClassName?: string;
  errorLogName?: string;
}

export const normalizeResourceDescription = (description?: string | null) => {
  const trimmed = description?.trim();
  return trimmed || null;
};

export const getResourceDescriptionText = (description?: string | null) => {
  const normalized = normalizeResourceDescription(description);
  return normalized ? stripMarkdown(normalized) || normalized : '';
};

const isClickOutsideIgnored = (event: Event) => {
  const originalEvent = (event as CustomEvent<{ originalEvent?: Event }>).detail?.originalEvent;
  const target = originalEvent?.target ?? event.target;

  return target instanceof Element && Boolean(target.closest('.click-outside-ignore'));
};

const splitSaveFailedLabel = (label: string) => {
  const separatorIndex = Math.max(
    label.lastIndexOf(','),
    label.lastIndexOf('，'),
    label.lastIndexOf('。')
  );

  if (separatorIndex === -1) {
    return { message: '', retry: label };
  }

  return {
    message: label.slice(0, separatorIndex + 1),
    retry: label.slice(separatorIndex + 1).trim(),
  };
};

const ResourceDescriptionDialog = ({
  description,
  open,
  onOpenChange,
  onSave,
  readOnly,
  errorLogName = 'resource',
}: IResourceDescriptionDialogProps) => {
  const { t } = useTranslation('common');
  const [value, setValue] = useState(description ?? '');
  const [editorKey, setEditorKey] = useState(0);
  const [saveStatus, setSaveStatus] = useState<DescriptionSaveStatus>('idle');
  const getEditorRef = useRef<(() => Parameters<typeof getEditorMarkdown>[0]) | null>(null);
  const savedValueRef = useRef<string | null>(normalizeResourceDescription(description));
  const isSavingRef = useRef(false);
  const prevOpenRef = useRef(open);

  const handleSaveError = useCallback(
    (error: unknown) => {
      console.error(`Failed to save ${errorLogName} description:`, error);
      setSaveStatus('error');
    },
    [errorLogName]
  );

  const saveDescription = useCallback(
    async (description: string | null) => {
      if (readOnly || description === savedValueRef.current) return;
      if (!onSave) return;
      isSavingRef.current = true;
      setSaveStatus('saving');
      try {
        await onSave(description);
        savedValueRef.current = description;
        setSaveStatus('idle');
      } finally {
        isSavingRef.current = false;
      }
    },
    [onSave, readOnly]
  );

  const saveCurrentValue = useCallback(async () => {
    const editor = getEditorRef.current?.();
    const markdown = editor ? getEditorMarkdown(editor) : undefined;
    const nextValue = normalizeResourceDescription(markdown ?? value);

    await saveDescription(nextValue);
  }, [saveDescription, value]);

  const handleOpenChange = useCallback(
    async (isOpen: boolean) => {
      if (isOpen) {
        onOpenChange(true);
        return;
      }

      if (isSavingRef.current) {
        return;
      }

      if (saveStatus === 'error') {
        onOpenChange(false);
        return;
      }

      try {
        await saveCurrentValue();
        onOpenChange(false);
      } catch (error) {
        handleSaveError(error);
      }
    },
    [handleSaveError, onOpenChange, saveCurrentValue, saveStatus]
  );

  const handleRetrySave = useCallback(async () => {
    if (isSavingRef.current) return;

    try {
      await saveCurrentValue();
      onOpenChange(false);
    } catch (error) {
      handleSaveError(error);
    }
  }, [handleSaveError, onOpenChange, saveCurrentValue]);

  const handleValueChange = useCallback(
    (nextValue: string) => {
      setValue(nextValue);
      if (saveStatus === 'error') {
        setSaveStatus('idle');
      }
    },
    [saveStatus]
  );

  const blurEditorOnDialogBlankClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target;

    if (!(target instanceof HTMLElement)) return;
    if (target.closest('.milkdown-editor-wrap, button, a, input, textarea, [role="button"]')) {
      return;
    }

    (document.activeElement as HTMLElement | null)?.blur();
  }, []);

  const preventIgnoredOutsideEvent = useCallback((event: Event) => {
    if (isClickOutsideIgnored(event)) {
      event.preventDefault();
    }
  }, []);

  useEffect(() => {
    const wasOpen = prevOpenRef.current;
    prevOpenRef.current = open;

    if (!open) return;

    const normalized = normalizeResourceDescription(description);

    if (wasOpen) {
      savedValueRef.current = normalized;
      return;
    }

    setValue(description ?? '');
    setEditorKey((key) => key + 1);
    getEditorRef.current = null;
    savedValueRef.current = normalized;
    isSavingRef.current = false;
    setSaveStatus('idle');
  }, [description, open]);

  const statusText = saveStatus === 'saving' ? t('resourceDescription.descriptionSaving') : '';
  const saveFailedLabel = splitSaveFailedLabel(t('resourceDescription.descriptionSaveFailed'));

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="flex max-h-[min(80vh,720px)] min-h-[240px] w-[calc(100vw-32px)] max-w-screen-sm flex-col overflow-visible rounded-lg"
        onMouseDown={blurEditorOnDialogBlankClick}
        onInteractOutside={preventIgnoredOutsideEvent}
        onPointerDownOutside={preventIgnoredOutsideEvent}
      >
        <DialogHeader>
          <DialogTitle className="flex min-w-0 flex-wrap items-center gap-2 pr-6">
            {t('resourceDescription.nodeDescription')}
            <span className="flex h-6 items-center rounded-md border bg-muted px-1.5 text-center text-xs font-medium leading-4 text-muted-foreground">
              Markdown
            </span>
            {saveStatus !== 'idle' && (
              <span
                className={cn(
                  'flex min-w-0 flex-wrap items-center gap-1.5 text-xs font-normal text-muted-foreground',
                  saveStatus === 'error' && 'text-destructive'
                )}
              >
                {saveStatus === 'saving' && <Spin className="size-3.5" />}
                {saveStatus === 'error' ? (
                  <>
                    {saveFailedLabel.message && <span>{saveFailedLabel.message}</span>}
                    <button
                      type="button"
                      className="underline underline-offset-2"
                      onClick={handleRetrySave}
                    >
                      {saveFailedLabel.retry}
                    </button>
                  </>
                ) : (
                  statusText
                )}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>
        <div className="min-h-0 overflow-visible">
          <MarkdownLongTextEditor
            key={editorKey}
            value={value}
            className="max-h-[min(calc(80vh-7.5rem),600px)] min-h-32 overflow-auto rounded-none border-0 bg-background p-0 text-sm focus-within:border-transparent hover:border-transparent dark:bg-background [&_.ProseMirror.editor]:p-0 [&_.milkdown-readonly-preview]:p-0"
            hideExpand
            hideMarkdownBadge
            readonly={readOnly}
            placeholder={t('resourceDescription.descriptionPlaceholder')}
            onValueChange={handleValueChange}
            onEditorReady={(getEditor) => {
              getEditorRef.current = getEditor;
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
};

export const ResourceDescription = ({
  canUpdate,
  description,
  onSave,
  fallback,
  className,
  readOnlyClassName,
  fallbackClassName,
  errorLogName,
}: IResourceDescriptionProps) => {
  const { t } = useTranslation('common');
  const [descriptionDialogOpen, setDescriptionDialogOpen] = useState(false);
  const normalizedDescription = normalizeResourceDescription(description);
  const descriptionText = getResourceDescriptionText(normalizedDescription);
  const canEditDescription = canUpdate && Boolean(onSave);
  const showAddDescription = !normalizedDescription && canEditDescription;
  const canOpenDescription = Boolean(normalizedDescription) || canEditDescription;
  const showDescription = Boolean(normalizedDescription) || showAddDescription;

  if (!showDescription) {
    return fallback ? (
      <div className={cn('text-[11px] leading-3 text-muted-foreground', fallbackClassName)}>
        {fallback}
      </div>
    ) : null;
  }

  return (
    <>
      {canOpenDescription ? (
        <Button
          variant="link"
          className={cn(
            'h-3 w-full justify-start p-0 text-left text-[11px] leading-3 text-muted-foreground hover:text-foreground',
            className
          )}
          onClick={() => setDescriptionDialogOpen(true)}
        >
          <span className="truncate">
            {descriptionText || t('resourceDescription.addDescription')}
          </span>
        </Button>
      ) : (
        <div
          className={cn(
            'h-3 w-full text-left text-[11px] leading-3 text-muted-foreground',
            readOnlyClassName
          )}
        >
          <span className="block truncate">{descriptionText}</span>
        </div>
      )}
      {canOpenDescription && (
        <ResourceDescriptionDialog
          description={description}
          open={descriptionDialogOpen}
          onOpenChange={setDescriptionDialogOpen}
          onSave={onSave}
          readOnly={!canEditDescription}
          errorLogName={errorLogName}
        />
      )}
    </>
  );
};
