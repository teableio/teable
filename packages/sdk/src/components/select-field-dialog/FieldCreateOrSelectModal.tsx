import { createFieldRoSchema, FieldType } from '@teable/core';
import type { IFieldVo, IFieldRo } from '@teable/core';
import { ArrowLeft } from '@teable/icons';
import {
  Button,
  Dialog,
  DialogClose,
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
import { FieldCreator } from './FieldCreator';

interface IFieldCreateOrSelectModalProps {
  title: ReactNode;
  content?: ReactNode;
  description?: ReactNode;
  selectedFieldId?: string;
  isCreatable?: boolean;
  getCreateBtnText: (fieldName: string) => ReactNode;
  children: (isActive: boolean) => React.ReactNode;
  onConfirm?: (field: IFieldVo | IFieldInstance) => void;
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
  } = props;
  const tableId = useTableId();
  const totalFields = useFields({ withHidden: true, withDenied: true });
  const { createField } = useFieldOperations();
  const getFieldStatic = useFieldStaticGetter();
  const [newField, setNewField] = useState<IFieldRo>();
  const { t } = useTranslation();
  const [selectedFieldId, setSelectedFieldId] = useState<string | undefined>(_selectedFieldId);
  const [open, setOpen] = useState(false);

  useImperativeHandle(forwardRef, () => ({
    onOpen: () => setOpen(true),
    onClose: () => setOpen(false),
  }));

  useEffect(() => {
    setSelectedFieldId(_selectedFieldId);
  }, [_selectedFieldId]);

  const onFieldSelect = (value: string) => {
    setSelectedFieldId(value);
  };

  const onConfirmInner = async () => {
    if (newField != null) {
      if (tableId == null) return setNewField(undefined);
      const result = createFieldRoSchema.safeParse(newField);
      if (result.success) {
        const field = await createField({ tableId, fieldRo: newField });
        setNewField(undefined);
        return onConfirm?.(field);
      }
      return setNewField(undefined);
    }
    if (selectedFieldId != null) {
      const selectedField = totalFields.find((field) => field.id === selectedFieldId);
      return selectedField ? onConfirm?.(selectedField) : undefined;
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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children(open)}</DialogTrigger>
      <DialogContent
        className="p-5"
        closeable={false}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader className="space-y-2">
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription className="text-xs">{description}</DialogDescription>}
        </DialogHeader>

        <div className="rounded-md bg-gray-50 p-3 pr-0 dark:bg-gray-900">
          <ScrollArea className="h-52 w-full" type="always">
            {newField ? (
              <FieldCreator field={newField} setField={setNewField} />
            ) : (
              <RadioGroup className="gap-4" value={selectedFieldId} onValueChange={onFieldSelect}>
                {filteredFields.map((field) => {
                  const { id, type, name, isLookup, aiConfig, canReadFieldRecord } = field;
                  const { Icon } = getFieldStatic(type, {
                    isLookup,
                    hasAiConfig: Boolean(aiConfig),
                    deniedReadRecord: !canReadFieldRecord,
                  });
                  return (
                    <div key={id} className="flex items-center space-x-2">
                      <RadioGroupItem value={id} id={id} />
                      <Label className="flex cursor-pointer items-center space-x-1" htmlFor={id}>
                        <Icon className="size-4" />
                        <span>{name}</span>
                      </Label>
                    </div>
                  );
                })}
              </RadioGroup>
            )}
          </ScrollArea>
        </div>

        {content}

        <DialogFooter className={cn(newField && 'justify-between sm:justify-between')}>
          {newField && (
            <Button variant={'ghost'} onClick={() => setNewField(undefined)}>
              <ArrowLeft />
              {t('common.back')}
            </Button>
          )}
          <DialogClose asChild>
            <Button disabled={!selectedFieldId && !newField} onClick={onConfirmInner}>
              {t('common.done')}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});

FieldCreateOrSelectModal.displayName = 'FieldCreateOrSelectModal';
