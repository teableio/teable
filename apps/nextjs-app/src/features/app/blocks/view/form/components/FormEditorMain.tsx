/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events */
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { generateAttachmentId } from '@teable-group/core';
import { Pencil } from '@teable-group/icons';
import type { INotifyVo } from '@teable-group/openapi';
import type { IFile } from '@teable-group/sdk/components/editor/attachment/upload-attachment/uploadManage';
import { AttachmentManager } from '@teable-group/sdk/components/editor/attachment/upload-attachment/uploadManage';
import { useIsHydrated, useView } from '@teable-group/sdk/hooks';
import type { FormView, IFieldInstance } from '@teable-group/sdk/model';
import { Button, Input, Textarea, cn } from '@teable-group/ui-lib/shadcn';
import { useRef, useState } from 'react';
import { FieldOperator } from '@/features/app/components/field-setting';
import { useGridViewStore } from '../../grid/store/gridView';
import { FORM_EDITOR_DROPPABLE_ID } from '../constant';
import { DroppableContainer, SortableItem } from './Drag';
import { FormFieldEditor } from './FormFieldEditor';

const attachmentManager = new AttachmentManager(2);

export const FormEditorMain = (props: { fields: IFieldInstance[] }) => {
  const { fields } = props;
  const view = useView();
  const isHydrated = useIsHydrated();
  const { openSetting } = useGridViewStore();
  const fileInput = useRef<HTMLInputElement>(null);
  const [coverUrl, setCoverUrl] = useState((view as FormView)?.options?.coverUrl ?? '');
  const [name, setName] = useState(view?.name ?? '');
  const [description, setDescription] = useState(view?.description ?? '');
  const { setNodeRef } = useDroppable({ id: FORM_EDITOR_DROPPABLE_ID });

  if (view == null) return null;

  const onNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setName(value);
  };

  const onNameInputBlur = () => {
    if (!name) {
      return setName(view.name);
    }
    view.updateName(name);
  };

  const onDescriptionChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setDescription(value);
  };

  const onFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;

    if (fileList == null) return;

    const files = Array.from(fileList);
    const uploadItem = { instance: files[0], id: generateAttachmentId() };
    attachmentManager.upload([uploadItem], {
      successCallback: (_file: IFile, attachment: INotifyVo) => {
        const url = attachment.url;
        setCoverUrl(url);
        (view as FormView).updateCover(url);
      },
    });
    e.target.value = '';
  };

  return (
    <div className="w-full overflow-y-auto sm:py-8">
      <div className="mx-auto flex w-full max-w-[640px] flex-col items-center overflow-hidden border pb-12 shadow-md sm:rounded-lg">
        <div
          className={cn(
            'relative h-36 w-full',
            !coverUrl && 'bg-gradient-to-tr from-green-400 via-blue-400 to-blue-600'
          )}
        >
          {coverUrl && (
            <img src={coverUrl} alt="form cover" className="h-full w-full object-cover" />
          )}
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

        <Input
          className="mb-6 mt-8 w-1/2 border-0 text-center text-3xl shadow-none hover:border"
          value={name}
          onChange={onNameChange}
          onBlur={onNameInputBlur}
        />

        <div className="mb-4 w-full px-12">
          <Textarea
            className="min-h-[80px] w-full resize-none"
            value={description}
            placeholder="Enter from description"
            onChange={onDescriptionChange}
            onBlur={() => view.updateDescription(description)}
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
