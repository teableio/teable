import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FieldType, type ILinkFieldOptions, type ILinkFieldOptionsRo } from '@teable/core';
import { Settings } from '@teable/icons';
import { convertField } from '@teable/openapi';
import { useFieldStaticGetter, useFields, useTableId, useTables, useView } from '@teable/sdk/hooks';
import type { IFieldInstance } from '@teable/sdk/model';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@teable/ui-lib';
import { Settings2 } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useEffect, useState } from 'react';
import { MoreLinkOptions } from '@/features/app/components/field-setting/options/LinkOptions/MoreLinkOptions';
import { tableConfig } from '@/features/i18n/table.config';

/**
 * Persistent amber notice that surfaces in the share panel whenever the
 * current view contains Link fields. Tells the owner that linked records
 * will be visible to share visitors and offers an inline shortcut to the
 * field-level scope editor. The editor itself writes to the field's global
 * options (table-wide), so the dialog header repeats that caveat.
 */
export const ShareLinkScopeSettings = () => {
  const tableId = useTableId() as string;
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const queryClient = useQueryClient();
  const allFields = useFields({ withHidden: true });
  const linkFields = allFields.filter((f) => f.type === FieldType.Link);

  // Notice surfaces only when the share is editable. View-only shares expose
  // just the already-linked records' primary field — bounded and expected.
  // allowEdit flips the door open: the link-picker lets visitors browse the
  // entire foreign table, which is the actual data-exposure jump worth a
  // warning.
  const view = useView();
  const allowEdit = Boolean(view?.shareMeta?.allowEdit);

  // Spell out the actual tables that get exposed so the owner can match the
  // warning to real data, not an abstract "linked table data". Cross-base
  // links (foreign table outside this base) won't resolve via useTables and
  // are silently dropped — better than rendering an unknown id.
  const tables = useTables();
  const foreignTableNames = (() => {
    const seen = new Set<string>();
    const names: string[] = [];
    for (const f of linkFields) {
      const fid = (f.options as ILinkFieldOptions).foreignTableId;
      if (!fid || seen.has(fid)) continue;
      seen.add(fid);
      const name = tables.find((t) => t.id === fid)?.name;
      if (name) names.push(name);
    }
    return names;
  })();

  const [dialogOpen, setDialogOpen] = useState(false);

  const { mutateAsync: updateLinkOptions, isPending: isSaving } = useMutation({
    mutationFn: async (args: { fieldId: string; options: ILinkFieldOptions }) => {
      return convertField(tableId, args.fieldId, {
        type: FieldType.Link,
        options: args.options as unknown as Record<string, unknown>,
      } as Parameters<typeof convertField>[2]);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fields', tableId] });
    },
  });

  if (linkFields.length === 0 || !allowEdit) {
    return null;
  }

  return (
    // modal=false so opening this dialog doesn't tear down the enclosing
    // share Dialog (UnifiedShareDialog). The link-scope dialog acts as a
    // sibling-feeling layer; the share panel stays mounted underneath.
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen} modal={false}>
      <div className="flex items-center justify-between gap-2 rounded-md border border-amber-700/20 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-500">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate">
            {foreignTableNames.length === 0
              ? t('table:baseShare.linkExposureNoticeGeneric')
              : foreignTableNames.length === 1
                ? t('table:baseShare.linkExposureNoticeOne', { name: foreignTableNames[0] })
                : t('table:baseShare.linkExposureNoticeMany', {
                    name: foreignTableNames[0],
                    count: foreignTableNames.length,
                  })}
          </span>
        </span>
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="shrink-0 whitespace-nowrap text-amber-700 hover:underline dark:text-amber-500"
        >
          {t('table:baseShare.restrictScope')} →
        </button>
      </div>
      <DialogContent className="max-h-[80vh] max-w-[400px] gap-2 overflow-hidden p-4">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Settings className="size-4" />
            {t('table:baseShare.linkScopeDialogTitle')}
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">{t('table:baseShare.linkScopeDesc')}</p>
        <div className="mt-2 flex max-h-[60vh] flex-col gap-2 overflow-y-auto">
          {linkFields.map((field) => (
            <LinkFieldScopeRow
              key={field.id}
              field={field}
              isSaving={isSaving}
              onSave={(options) => updateLinkOptions({ fieldId: field.id, options })}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
};

interface IRowProps {
  field: IFieldInstance;
  isSaving: boolean;
  onSave: (options: ILinkFieldOptions) => Promise<unknown>;
}

const LinkFieldScopeRow = ({ field, isSaving, onSave }: IRowProps) => {
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const fieldStaticGetter = useFieldStaticGetter();
  const FieldIcon = fieldStaticGetter(field.type).Icon;
  const fieldOptions = field.options as ILinkFieldOptions;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ILinkFieldOptions>(fieldOptions);
  // Sync draft from latest server state whenever the popover is closed, so
  // (a) reopening always shows the just-saved values and (b) abandoned edits
  // don't leak into the next session.
  useEffect(() => {
    if (!open) setDraft(fieldOptions);
  }, [open, fieldOptions]);
  const dirty = draft !== fieldOptions;

  return (
    <Popover modal open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="w-full justify-between">
          <span className="flex min-w-0 items-center gap-2">
            {FieldIcon && <FieldIcon className="size-4 shrink-0 text-muted-foreground" />}
            <span className="truncate">{field.name}</span>
          </span>
          <Settings2 className="size-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        collisionPadding={16}
        className="max-h-[calc(var(--radix-popover-content-available-height)-1rem)] w-96 overflow-y-auto p-4"
      >
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
          {FieldIcon && <FieldIcon className="size-4 shrink-0 text-muted-foreground" />}
          <span className="truncate">{field.name}</span>
        </div>
        <MoreLinkOptions
          foreignTableId={draft.foreignTableId}
          fieldId={field.id}
          filterByViewId={draft.filterByViewId}
          visibleFieldIds={draft.visibleFieldIds}
          filter={draft.filter}
          lookupFieldId={draft.lookupFieldId}
          onChange={(partial: Partial<ILinkFieldOptionsRo>) => {
            setDraft((prev) => ({ ...prev, ...partial }) as ILinkFieldOptions);
          }}
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
            {t('common:actions.cancel')}
          </Button>
          <Button
            size="sm"
            disabled={!dirty || isSaving}
            onClick={async () => {
              await onSave(draft);
              setOpen(false);
            }}
          >
            {t('common:actions.save')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};
