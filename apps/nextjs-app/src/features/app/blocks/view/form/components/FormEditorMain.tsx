import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { generateAttachmentId } from '@teable/core';
import { Pencil } from '@teable/icons';
import type { INotifyVo } from '@teable/openapi';
import { UploadType } from '@teable/openapi';
import type { IFile } from '@teable/sdk/components';
import { AttachmentManager } from '@teable/sdk/components';
import { useIsHydrated, useView } from '@teable/sdk/hooks';
import type { FormView, IFieldInstance } from '@teable/sdk/model';
import { Button, Input, Textarea, cn } from '@teable/ui-lib/shadcn';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FieldOperator } from '@/features/app/components/field-setting';
import { tableConfig } from '@/features/i18n/table.config';
import { useFieldSettingStore } from '../../field/useFieldSettingStore';
import { FORM_EDITOR_DROPPABLE_ID } from '../constant';
import { DroppableContainer, SortableItem } from './Drag';
import { FormFieldEditor } from './FormFieldEditor';

const attachmentManager = new AttachmentManager(2);

export const FormEditorMain = (props: { fields: IFieldInstance[] }) => {
  const { fields } = props;
  const view = useView();
  const isHydrated = useIsHydrated();
  const { openSetting } = useFieldSettingStore();
  const fileInput = useRef<HTMLInputElement>(null);
  const [coverUrl, setCoverUrl] = useState((view as FormView)?.options?.coverUrl ?? '');
  const [name, setName] = useState(view?.name ?? '');
  const [isNameEditing, setNameEditing] = useState(false);
  const [description, setDescription] = useState(view?.description ?? '');
  const { setNodeRef } = useDroppable({ id: FORM_EDITOR_DROPPABLE_ID });
  const { t } = useTranslation(tableConfig.i18nNamespaces);

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

  const onFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;

    if (fileList == null) return;

    const files = Array.from(fileList);
    const uploadItem = { instance: files[0], id: generateAttachmentId() };
    attachmentManager.upload([uploadItem], UploadType.Form, {
      successCallback: (_file: IFile, attachment: INotifyVo) => {
        const url = attachment.url;
        setCoverUrl(url);
        view.updateOption({ coverUrl: url });
      },
    });
    e.target.value = '';
  };

  const onNameClick = () => {
    if (!isNameEditing) {
      setNameEditing(true);
    }
  };

  return (
    <div className="w-full overflow-y-auto sm:py-8">
      <div className="mx-auto flex w-full max-w-[640px] flex-col items-center overflow-hidden border pb-12 shadow-md sm:rounded-lg">
        <div
          className={cn(
            'relative h-36 w-full',
            !coverUrl &&
              'bg-gradient-to-tr from-green-400 via-blue-400 to-blue-600 dark:from-green-600 dark:via-blue-600 dark:to-blue-900'
          )}
        >
          {coverUrl && <img src={coverUrl} alt="form cover" className="size-full object-cover" />}
          <Button
            variant={'ghost'}
            size={'icon'}
            className="absolute left-2 top-2 m-1 bg-accent/40 font-normal"
            onClick={() => fileInput.current?.click()}
          >
            <input type="file" className="hidden" ref={fileInput} onChange={onFileSelected} />
            <Pencil />
          </Button>
        </div>

        {isNameEditing ? (
          <Input
            className="mb-6 mt-8 w-2/3 text-center text-3xl shadow-none"
            value={name}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            onChange={onNameChange}
            onBlur={onNameInputBlur}
          />
        ) : (
          <div
            className="mb-6 mt-8 w-full px-6 text-center text-3xl sm:px-12"
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
            {name ?? 'Untitled'}
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
      </div>
    </div>
  );
};
