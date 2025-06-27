import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { generateAttachmentId } from '@teable/core';
import { Pencil, Plus } from '@teable/icons';
import type { INotifyVo } from '@teable/openapi';
import { UploadType } from '@teable/openapi';
import type { IFile } from '@teable/sdk/components';
import { AttachmentManager } from '@teable/sdk/components';
import { useIsHydrated, useView } from '@teable/sdk/hooks';
import type { FormView, IFieldInstance } from '@teable/sdk/model';
import {
  Button,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Textarea,
  cn,
} from '@teable/ui-lib/shadcn';
import Image from 'next/image';
import { useTranslation } from 'next-i18next';
import { useEffect, useRef, useState } from 'react';
import { FieldOperator } from '@/features/app/components/field-setting';
import { usePreviewUrl } from '@/features/app/hooks/usePreviewUrl';
import { tableConfig } from '@/features/i18n/table.config';
import { useFieldSettingStore } from '../../field/useFieldSettingStore';
import { FORM_EDITOR_DROPPABLE_ID } from '../constant';
import { DroppableContainer } from './Drag';
import { FormFieldEditor } from './FormFieldEditor';
import { SortableItem } from './SortableItem';

const attachmentManager = new AttachmentManager(2);

export const FormEditorMain = (props: { fields: IFieldInstance[] }) => {
  const { fields } = props;
  const view = useView() as FormView | undefined;
  const isHydrated = useIsHydrated();
  const { openSetting } = useFieldSettingStore();

  const coverInput = useRef<HTMLInputElement>(null);
  const logoInput = useRef<HTMLInputElement>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  const [name, setName] = useState(view?.name ?? '');
  const [isNameEditing, setNameEditing] = useState(false);
  const [description, setDescription] = useState(view?.description ?? '');
  const [coverUrl, setCoverUrl] = useState(view?.options?.coverUrl ?? '');
  const [logoUrl, setLogoUrl] = useState(view?.options?.logoUrl ?? '');
  const [submitLabel, setSubmitLabel] = useState(view?.options?.submitLabel);

  const { setNodeRef } = useDroppable({ id: FORM_EDITOR_DROPPABLE_ID });
  const { t } = useTranslation(tableConfig.i18nNamespaces);
  const previewUrl = usePreviewUrl();

  useEffect(() => {
    if (viewRef.current == null) return;
    const { name = '', description = '', options } = viewRef.current;
    const { coverUrl = '', logoUrl = '', submitLabel } = options ?? {};
    setName(name);
    setNameEditing(false);
    setDescription(description);
    setCoverUrl(coverUrl);
    setLogoUrl(logoUrl);
    setSubmitLabel(submitLabel);
  }, [view?.id]);

  if (view == null) return null;

  const onNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setName(value);
  };

  const onNameInputBlur = async () => {
    if (name === view.name) return setNameEditing(false);
    if (!name) {
      return setName(view.name);
    }
    await view.updateName(name);
    setNameEditing(false);
  };

  const onDescriptionChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setDescription(value);
  };

  const onDescriptionBlur = async () => {
    if (description === view.description) return;
    await view.updateDescription(description);
  };

  const onFileSelected = (e: React.ChangeEvent<HTMLInputElement>, type: 'logo' | 'cover') => {
    const fileList = e.target.files;

    if (fileList == null) return;

    const isCover = type === 'cover';
    const files = Array.from(fileList);
    const uploadItem = { instance: files[0], id: generateAttachmentId() };
    attachmentManager.upload([uploadItem], UploadType.Form, {
      successCallback: (_file: IFile, attachment: INotifyVo) => {
        const { path } = attachment;
        const optionProp = isCover ? 'coverUrl' : 'logoUrl';
        isCover ? setCoverUrl(path) : setLogoUrl(path);
        view.updateOption({ [optionProp]: path });
      },
    });
    e.target.value = '';
  };

  const onSubmitTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSubmitLabel(value);
  };

  const onSubmitTextInputBlur = async () => {
    if (submitLabel === view.options?.submitLabel) return;
    if (!submitLabel) {
      await view.updateOption({ submitLabel: t('common:actions.submit') });
      return setSubmitLabel(t('common:actions.submit'));
    }
    await view.updateOption({ submitLabel });
  };

  const onNameClick = () => {
    if (!isNameEditing) {
      setNameEditing(true);
    }
  };

  return (
    <div className="w-full overflow-y-auto sm:py-8">
      <div className="relative mx-auto flex w-full max-w-screen-sm flex-col items-center overflow-hidden border pb-12 shadow-md sm:rounded-lg">
        <div
          className={cn(
            'relative h-36 w-full',
            !coverUrl &&
              'bg-gradient-to-tr from-green-400 via-blue-400 to-blue-600 dark:from-green-600 dark:via-blue-600 dark:to-blue-900'
          )}
        >
          {coverUrl && (
            <Image
              src={previewUrl(coverUrl)}
              alt="card cover"
              fill
              sizes="100%"
              style={{
                objectFit: 'cover',
              }}
            />
          )}
          <Button
            variant={'ghost'}
            size={'icon'}
            className="absolute left-2 top-2 m-1 bg-accent/40 font-normal"
            onClick={() => coverInput.current?.click()}
          >
            <input
              type="file"
              className="hidden"
              ref={coverInput}
              onChange={(e) => onFileSelected(e, 'cover')}
            />
            <Pencil />
          </Button>
        </div>

        <div className="group absolute left-1/2 top-[104px] ml-[-40px] size-20">
          {logoUrl ? (
            <>
              <Image
                className="rounded-lg object-cover shadow-sm"
                src={previewUrl(logoUrl)}
                alt="card cover"
                fill
                sizes="100%"
              />
              <Button
                variant={'ghost'}
                size={'icon'}
                className="absolute left-0 top-0 size-full font-normal opacity-0 group-hover:opacity-30"
                onClick={() => logoInput.current?.click()}
              >
                <Pencil className="size-6" />
              </Button>
            </>
          ) : (
            <Button
              variant={'outline'}
              size={'icon'}
              className="size-full rounded-lg font-normal"
              onClick={() => logoInput.current?.click()}
            >
              <Plus className="size-8" />
            </Button>
          )}
          <input
            type="file"
            className="hidden"
            ref={logoInput}
            onChange={(e) => onFileSelected(e, 'logo')}
          />
        </div>

        {isNameEditing ? (
          <Input
            className="mb-6 mt-16 w-2/3 text-center text-3xl shadow-none"
            value={name}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            onChange={onNameChange}
            onBlur={onNameInputBlur}
          />
        ) : (
          <div
            className="mb-6 mt-16 w-full px-6 text-center text-3xl sm:px-12"
            style={{ overflowWrap: 'break-word' }}
            tabIndex={0}
            role={'button'}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                onNameClick();
              }
            }}
            onClick={onNameClick}
          >
            {name ?? t('untitled')}
          </div>
        )}

        <div className="mb-4 w-full px-12">
          <Textarea
            className="min-h-[80px] w-full resize-none"
            value={description}
            placeholder={t('table:form.descriptionPlaceholder')}
            onChange={onDescriptionChange}
            onBlur={onDescriptionBlur}
          />
        </div>

        <div className="w-full px-4">
          {isHydrated && (
            <DroppableContainer id={FORM_EDITOR_DROPPABLE_ID} items={fields}>
              <SortableContext items={fields} strategy={verticalListSortingStrategy}>
                {!fields.length && (
                  <div className="flex h-20 w-full items-center justify-center rounded border border-dashed text-sm text-slate-400 dark:text-slate-600">
                    {t('table:form.dragToFormTip')}
                  </div>
                )}
                <div ref={setNodeRef}>
                  {fields.map((field, index) => {
                    const { id } = field;
                    return (
                      <SortableItem
                        key={id}
                        id={id}
                        index={index}
                        field={field}
                        className="w-full overflow-hidden rounded-md hover:bg-slate-100/80 dark:hover:bg-slate-800/80"
                        draggingClassName="bg-slate-100 dark:bg-slate-800 border border-black border-dashed opacity-50"
                        onClick={() => openSetting({ operator: FieldOperator.Edit, fieldId: id })}
                      >
                        <FormFieldEditor field={field} />
                      </SortableItem>
                    );
                  })}
                </div>
              </SortableContext>
            </DroppableContainer>
          )}
        </div>

        <div className="mb-12 mt-8 flex w-full items-center justify-center sm:mb-0 sm:px-12">
          <Button className="mr-2 w-full text-base sm:w-56" size={'lg'}>
            {submitLabel ?? t('common:actions.submit')}
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant={'ghost'} size={'icon'} className="font-normal">
                <Pencil />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start" side="right">
              <Input
                maxLength={12}
                value={submitLabel}
                onChange={onSubmitTextChange}
                onBlur={onSubmitTextInputBlur}
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </div>
  );
};
