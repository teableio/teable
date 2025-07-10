import { deleteFields } from '@teable/openapi';
import { useFields, useFieldStaticGetter } from '@teable/sdk/hooks';
import { ConfirmDialog } from '@teable/ui-lib/base';
import { Button } from '@teable/ui-lib/shadcn';
import { cn } from '@teable/ui-lib/shadcn/utils';
import { first } from 'lodash';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { DynamicFieldGraph } from '@/features/app/blocks/graph/DynamicFieldGraph';

interface FieldDeleteConfirmDialogProps {
  open: boolean;
  tableId: string;
  fieldIds: string[];
  onClose?: () => void;
}

const FieldGraphListPanel = (props: { tableId: string; fieldIds: string[] }) => {
  const { tableId, fieldIds } = props;
  const fieldStaticGetter = useFieldStaticGetter();
  const allFields = useFields();
  const fields = allFields.filter((field) => fieldIds.includes(field.id));
  const [activeFieldId, setActiveFieldId] = useState(first(fields)?.id);
  return (
    <>
      <div className="w-full">
        {fields.map((field) => {
          const { Icon } = fieldStaticGetter(field.type, {
            isLookup: field.isLookup,
            hasAiConfig: Boolean(field.aiConfig),
            deniedReadRecord: !field.canReadFieldRecord,
          });
          return (
            <Button
              key={field.id}
              variant={'ghost'}
              size={'xs'}
              className={cn('font-normal shrink-0 truncate', {
                'bg-secondary': activeFieldId === field.id,
              })}
              onClick={() => setActiveFieldId(field.id)}
            >
              <Icon className="size-4 text-sm" />
              <span className={cn('truncate max-w-32')}>{field.name}</span>
            </Button>
          );
        })}
      </div>
      <DynamicFieldGraph fieldId={activeFieldId} tableId={tableId} fieldAction="field|delete" />
    </>
  );
};

export const FieldDeleteConfirmDialog = (props: FieldDeleteConfirmDialogProps) => {
  const { tableId, fieldIds, open, onClose } = props;
  const { t } = useTranslation(['common', 'table']);

  const close = () => {
    onClose?.();
  };

  const actionDelete = async () => {
    await deleteFields(tableId, fieldIds);
    close();
  };

  return (
    <ConfirmDialog
      contentClassName="max-w-6xl"
      title={t('table:table.actionTips.deleteFieldConfirmTitle')}
      open={open}
      onOpenChange={(open) => {
        if (!open) {
          onClose?.();
        }
      }}
      content={
        <>
          <FieldGraphListPanel tableId={tableId} fieldIds={fieldIds} />
        </>
      }
      cancelText={t('common:actions.cancel')}
      confirmText={t('common:actions.confirm')}
      onCancel={close}
      onConfirm={actionDelete}
    />
  );
};
