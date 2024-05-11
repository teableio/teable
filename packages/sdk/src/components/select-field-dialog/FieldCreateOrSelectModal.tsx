import { createFieldRoSchema, getUniqName } from '@teable/core';
import type { IFieldVo, FieldType, IFieldRo } from '@teable/core';
import { ArrowLeft, Plus } from '@teable/icons';
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
import { useFieldStaticGetter, useFields, useTableId } from '../../hooks';
import type { IFieldInstance } from '../../model';
import { Field } from '../../model';
import { FieldCreator } from './FieldCreator';

interface IFieldCreateOrSelectModalProps {
  title: ReactNode;
  content?: ReactNode;
  description?: ReactNode;
  fieldTypes: FieldType[];
  selectedFieldId?: string;
  isMultipleEnable?: boolean;
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
    content,
    description,
    fieldTypes,
    selectedFieldId: _selectedFieldId,
    isMultipleEnable,
    isCreatable,
    children,
    onConfirm,
    getCreateBtnText,
  } = props;
  const tableId = useTableId();
  const totalFields = useFields({ withHidden: true, withDenied: true });
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

  const filteredFields = useMemo(() => {
    return totalFields.filter(({ type, isMultipleCellValue }) => {
      if (isMultipleEnable) {
        return fieldTypes.includes(type);
      }
      return !isMultipleCellValue && fieldTypes.includes(type);
    });
  }, [fieldTypes, totalFields, isMultipleEnable]);

  const onNewFieldEdit = (field: IFieldRo) => {
    const { name: originName } = field;
    const allExistNames = totalFields.map(({ name }) => name);
    const name = getUniqName(originName as string, allExistNames);

    setNewField({ ...field, name });
    setSelectedFieldId(undefined);
  };

  const onFieldSelect = (value: string) => {
    setSelectedFieldId(value);
  };

  const onConfirmInner = async () => {
    if (newField != null) {
      if (tableId == null) return setNewField(undefined);
      const result = createFieldRoSchema.safeParse(newField);
      if (result.success) {
        const field = (await Field.createField(tableId, newField)).data;
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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children(open)}</DialogTrigger>
      <DialogContent
        className="p-5"
        closeable={false}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="space-y-2">
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription className="text-xs">{description}</DialogDescription>}
        </DialogHeader>

        <ScrollArea className="h-36 w-full" type="always">
          <div className="px-2">
            {newField ? (
              <FieldCreator field={newField} setField={setNewField} />
            ) : (
              <RadioGroup className="gap-4" value={selectedFieldId} onValueChange={onFieldSelect}>
                {filteredFields.map((field) => {
                  const { id, type, name, isLookup } = field;
                  const { Icon } = getFieldStatic(type, isLookup);
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
          </div>
        </ScrollArea>

        {!newField && (
          <div className="flex flex-col space-y-2">
            {fieldTypes.map((type) => {
              const { title, Icon, defaultOptions } = getFieldStatic(type, false);
              return (
                <Button
                  key={type}
                  variant="secondary"
                  className="justify-start"
                  disabled={!isCreatable}
                  onClick={() => {
                    if (!isCreatable) return;
                    onNewFieldEdit({
                      type,
                      name: title,
                      options: defaultOptions,
                    } as IFieldRo);
                  }}
                >
                  <Plus className="size-5" />
                  <Icon className="size-4" />
                  {getCreateBtnText(title)}
                </Button>
              );
            })}
          </div>
        )}

        {!newField && content}

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
