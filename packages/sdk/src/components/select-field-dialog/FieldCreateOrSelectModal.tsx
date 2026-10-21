import { createFieldRoSchema, FieldType } from '@teable/core';
import type { IFieldVo, IFieldRo } from '@teable/core';
import { ArrowLeft } from '@teable/icons';
import {
  Button,
  Dialog,
  DialogContent,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerSafeArea,
  DrawerTitle,
  DrawerTrigger,
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
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { useTranslation } from '../../context/app/i18n';
import { useFieldOperations, useFieldStaticGetter, useFields, useTableId } from '../../hooks';
import type { IFieldInstance } from '../../model';
import { DrawerStackContext, useIsDrawerPanel } from '../adaptive-panel';
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
  /** Render as a bottom drawer on narrow viewports. Toolbar call sites only. */
  responsive?: boolean;
  children: (isActive: boolean) => React.ReactNode;
  onConfirm?: (field: IFieldVo | IFieldInstance) => void | Promise<void>;
}

export interface IFieldCreateOrSelectModalRef {
  onOpen: () => void;
  onClose: () => void;
}

/**
 * Radix `ScrollArea` needs a definite height: its viewport is `height: 100%`,
 * so with an `auto` root the viewport grows to the full content height and
 * never overflows, while the root's `max-height` clips it with no way to
 * scroll. In the drawer the height must follow the number of fields within
 * bounds, so use a plain scroll container there instead.
 */
const ScrollAreaOrDiv = ({
  isDrawer,
  children,
}: {
  isDrawer: boolean;
  children: React.ReactNode;
}) =>
  isDrawer ? (
    <div className="min-h-24 w-full overflow-y-auto overscroll-contain p-4 [max-height:min(50vh,25rem)]">
      {children}
    </div>
  ) : (
    <ScrollArea className="h-52 w-full p-4" type="always">
      {children}
    </ScrollArea>
  );

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
    responsive,
  } = props;
  const isDrawer = useIsDrawerPanel(responsive);
  const tableId = useTableId();
  const totalFields = useFields({ withHidden: true, withDenied: true });
  const { createField } = useFieldOperations();
  const getFieldStatic = useFieldStaticGetter();
  const [newField, setNewField] = useState<IFieldRo>();
  const { t } = useTranslation();
  const [selectedFieldId, setSelectedFieldId] = useState<string | undefined>(_selectedFieldId);
  const [open, setOpen] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);

  const onOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        setSelectedFieldId(_selectedFieldId);
        setNewField(undefined);
      }
      setOpen(nextOpen);
    },
    [_selectedFieldId]
  );

  const drawerStack = useMemo(
    () => ({ depth: 1, close: () => onOpenChange(false) }),
    [onOpenChange]
  );

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

  const fieldList = (
    <div className="relative rounded-md bg-muted">
      {readOnly && !isDrawer && <ReadOnlyTip />}
      <ScrollAreaOrDiv isDrawer={isDrawer}>
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
                    '-mx-2 flex h-8 items-center space-x-3 rounded-sm px-2 transition-colors rtl:space-x-reverse',
                    isDrawer && 'h-9',
                    isDrawer && selectedFieldId === id && 'bg-accent text-accent-foreground',
                    readOnly ? 'cursor-not-allowed' : 'cursor-pointer hover:text-foreground/70'
                  )}
                >
                  <RadioGroupItem
                    value={id}
                    id={id}
                    disabled={readOnly}
                    className="relative after:absolute after:left-1/2 after:top-1/2 after:hidden after:size-2 after:-translate-x-1/2 after:-translate-y-1/2 after:rounded-full after:bg-primary data-[state=checked]:after:block [&_svg]:hidden"
                  />
                  {/* Truncation is a drawer concern; the desktop dialog keeps
                      its original overflow behaviour. */}
                  <span
                    className={cn(
                      'flex items-center space-x-2 rtl:space-x-reverse',
                      isDrawer && 'min-w-0'
                    )}
                  >
                    <Icon className={cn('size-4', isDrawer && 'shrink-0')} />
                    <span className={cn(isDrawer && 'truncate')}>{name}</span>
                  </span>
                </Label>
              );
            })}
          </RadioGroup>
        )}
      </ScrollAreaOrDiv>
    </div>
  );

  const extraContent = (
    <div className="relative">
      {readOnly && !isDrawer && <ReadOnlyTip />}
      {content}
    </div>
  );

  const backButton = newField ? (
    <Button variant={'ghost'} disabled={readOnly} onClick={() => setNewField(undefined)}>
      <ArrowLeft className="size-4 shrink-0" />
      {t('common.back')}
    </Button>
  ) : null;

  const doneButton = (
    <Button
      disabled={isConfirming || (!readOnly && !selectedFieldId && !newField)}
      className={cn(isDrawer && !newField && 'w-full')}
      onClick={onConfirmInner}
    >
      {t('common.done')}
    </Button>
  );

  if (isDrawer) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerTrigger asChild>{children(open)}</DrawerTrigger>
        <DrawerContent
          onInteractOutside={onDismissAttempt}
          onEscapeKeyDown={onDismissAttempt}
          {...(description ? {} : { 'aria-describedby': undefined })}
        >
          {/* No way out until a stacking field exists - the view cannot
              render without one. Once one is chosen, dismissal is allowed and
              the close button appears. */}
          <DrawerHeader
            // The header Close calls Radix's onOpenChange directly and never
            // reaches onDismissAttempt, so the in-flight guard has to be here too.
            closeable={_selectedFieldId != null && !isConfirming}
            closeLabel={t('common.close')}
          >
            <DrawerTitle>{title}</DrawerTitle>
            {description && <DrawerDescription>{description}</DrawerDescription>}
          </DrawerHeader>
          <DrawerStackContext.Provider value={drawerStack}>
            {/* A single locked-view explanation covering the body. It must not
                extend over the footer: with no stacking field chosen there is
                no close button and no Escape, so blocking Done would trap the
                user in the drawer. */}
            <div className="relative flex min-h-0 flex-1 flex-col">
              {readOnly && <ReadOnlyTip />}
              <DrawerBody className="flex flex-col gap-4 p-4">
                {fieldList}
                {extraContent}
              </DrawerBody>
            </div>
            <DrawerFooter className={cn('flex items-center gap-2', newField && 'justify-between')}>
              {backButton}
              {doneButton}
            </DrawerFooter>
          </DrawerStackContext.Provider>
          <DrawerSafeArea />
        </DrawerContent>
      </Drawer>
    );
  }

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

        {fieldList}

        {extraContent}

        <DialogFooter className={cn(newField && 'justify-between sm:justify-between')}>
          {backButton}
          {doneButton}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});

FieldCreateOrSelectModal.displayName = 'FieldCreateOrSelectModal';
