import { createFieldRoSchema, FieldType } from '@teable/core';
import type { IFieldVo, IFieldRo } from '@teable/core';
import { ArrowLeft } from '@teable/icons';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Label,
  RadioGroup,
  RadioGroupItem,
  ScrollArea,
  cn,
} from '@teable/ui-lib';
import type { ReactNode } from 'react';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { useTranslation } from '../../context/app/i18n';
import { useFieldOperations, useFieldStaticGetter, useFields, useTableId } from '../../hooks';
import type { IFieldInstance } from '../../model';
import { ReadOnlyTip } from '../ReadOnlyTip';
import { FieldCreator } from './FieldCreator';

interface IFieldCreateOrSelectModalProps {
  title: ReactNode;
  content?: ReactNode;
  description?: ReactNode;
  selectedFieldId?: string;
  isCreatable?: boolean;
  readOnly?: boolean;
  getCreateBtnText: (fieldName: string) => ReactNode;
  children: (isActive: boolean) => React.ReactNode;
  onConfirm?: (field: IFieldVo | IFieldInstance) => void | Promise<void>;
}

export interface IFieldCreateOrSelectModalRef {
  onOpen: () => void;
  onClose: () => void;
}

export const FieldCreateOrSelectModal = forwardRef<
  IFieldCreateOrSelectModalRef,
  IFieldCreateOrSelectModalProps
>((props, forwardRef) => {
  const {
    title,
    description,
    content,
    selectedFieldId: _selectedFieldId,
    children,
    onConfirm,
    readOnly,
  } = props;
  const tableId = useTableId();
  const totalFields = useFields({ withHidden: true, withDenied: true });
  const { createField } = useFieldOperations();
  const getFieldStatic = useFieldStaticGetter();
  const [newField, setNewField] = useState<IFieldRo>();
  const { t } = useTranslation();
  const [selectedFieldId, setSelectedFieldId] = useState<string | undefined>(_selectedFieldId);
  const [open, setOpen] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);

  const onOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setSelectedFieldId(_selectedFieldId);
      setNewField(undefined);
    }
    setOpen(nextOpen);
  };

  const onDismissAttempt = (event: Event) => {
    if (isConfirming || _selectedFieldId == null) event.preventDefault();
  };

  useImperativeHandle(forwardRef, () => ({
    onOpen: () => onOpenChange(true),
    onClose: () => onOpenChange(false),
  }));

  useEffect(() => {
    setSelectedFieldId(_selectedFieldId);
  }, [_selectedFieldId]);

  const onFieldSelect = (value: string) => {
    if (readOnly) return;
    setSelectedFieldId(value);
  };

  const onConfirmInner = async () => {
    if (readOnly) return onOpenChange(false);
    if (isConfirming) return;

    setIsConfirming(true);
    try {
      let field: IFieldVo | IFieldInstance | undefined;
      if (newField != null) {
        if (tableId == null) return setNewField(undefined);
        const result = createFieldRoSchema.safeParse(newField);
        if (!result.success) return setNewField(undefined);
        field = await createField({ tableId, fieldRo: newField });
        setNewField(undefined);
      } else if (selectedFieldId != null) {
        field = totalFields.find(({ id }) => id === selectedFieldId);
      }

      if (field == null) return;
      await onConfirm?.(field);
      onOpenChange(false);
    } catch {
      // Request handlers surface the error; keep the dialog open for retry.
    } finally {
      setIsConfirming(false);
    }
  };

  const filteredFields = useMemo(() => {
    return totalFields.filter((field) => {
      const { type } = field;
      if (type === FieldType.Attachment || type === FieldType.Button) {
        return false;
      }
      return true;
    });
  }, [totalFields]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{children(open)}</DialogTrigger>
      <DialogContent
        className="p-5"
        closeable={false}
        onInteractOutside={onDismissAttempt}
        onEscapeKeyDown={onDismissAttempt}
      >
        <DialogHeader className="space-y-2">
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription className="text-sm">{description}</DialogDescription>}
        </DialogHeader>

        <div className="relative rounded-md bg-muted">
          {readOnly && <ReadOnlyTip />}
          <ScrollArea className="h-52 w-full p-4" type="always">
            {newField ? (
              <FieldCreator field={newField} setField={setNewField} />
            ) : (
              <RadioGroup className="gap-0" value={selectedFieldId} onValueChange={onFieldSelect}>
                {filteredFields.map((field) => {
                  const { id, type, name, isLookup, aiConfig, canReadFieldRecord } = field;
                  const { Icon } = getFieldStatic(type, {
                    isLookup,
                    isConditionalLookup: field.isConditionalLookup,
                    hasAiConfig: Boolean(aiConfig),
                    deniedReadRecord: !canReadFieldRecord,
                  });
                  return (
                    <Label
                      key={id}
                      htmlFor={id}
                      className={cn(
                        '-mx-2 flex h-8 items-center space-x-3 rounded-sm px-2 transition-colors',
                        readOnly ? 'cursor-not-allowed' : 'cursor-pointer hover:text-foreground/70'
                      )}
                    >
                      <RadioGroupItem
                        value={id}
                        id={id}
                        disabled={readOnly}
                        className="relative after:absolute after:left-1/2 after:top-1/2 after:hidden after:size-2 after:-translate-x-1/2 after:-translate-y-1/2 after:rounded-full after:bg-primary data-[state=checked]:after:block [&_svg]:hidden"
                      />
                      <span className="flex items-center space-x-2">
                        <Icon className="size-4" />
                        <span>{name}</span>
                      </span>
                    </Label>
                  );
                })}
              </RadioGroup>
            )}
          </ScrollArea>
        </div>

        <div className="relative">
          {readOnly && <ReadOnlyTip />}
          {content}
        </div>

        <DialogFooter className={cn(newField && 'justify-between sm:justify-between')}>
          {newField && (
            <Button variant={'ghost'} disabled={readOnly} onClick={() => setNewField(undefined)}>
              <ArrowLeft className="size-4 shrink-0" />
              {t('common.back')}
            </Button>
          )}
          <Button
            disabled={isConfirming || (!readOnly && !selectedFieldId && !newField)}
            onClick={onConfirmInner}
          >
            {t('common.done')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});

FieldCreateOrSelectModal.displayName = 'FieldCreateOrSelectModal';
