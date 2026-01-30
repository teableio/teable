import type { DropResult } from '@hello-pangea/dnd';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DraggableHandle, Settings, Plus, Edit, Trash } from '@teable/icons';
import type { ITemplateCategoryListVo } from '@teable/openapi';
import {
  createTemplateCategory,
  deleteTemplateCategory,
  getTemplateCategoryList,
  updateTemplateCategory,
  updateTemplateCategoryOrder,
} from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  cn,
} from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { useTranslation } from 'next-i18next';
import { useState, useEffect, useRef } from 'react';

const CategoryDraggableItem = ({
  category,
  isDragging,
  isClone,
  onEdit,
  onDelete,
}: {
  category: ITemplateCategoryListVo;
  isDragging?: boolean;
  isClone?: boolean;
  onEdit?: (id: string, name: string) => void;
  onDelete?: (id: string) => void;
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSave = () => {
    if (name && name !== category.name) {
      onEdit?.(category.id, name);
    }
    setIsEditing(false);
  };

  return (
    <div
      className={cn('group flex items-center gap-2 rounded-md border bg-background px-3 py-2', {
        'opacity-50': isDragging,
      })}
    >
      <DraggableHandle className="size-4 shrink-0 cursor-grab text-gray-400 active:cursor-grabbing" />
      {isEditing && !isClone ? (
        <Input
          className="h-6 flex-1 py-0"
          value={name}
          ref={inputRef}
          onChange={(e) => setName(e.target.value)}
          onBlur={handleSave}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              handleSave();
            }
            if (e.key === 'Escape') {
              setName(category.name);
              setIsEditing(false);
            }
          }}
        />
      ) : (
        <>
          <span className="flex h-6 flex-1 items-center truncate text-sm">{category.name}</span>
          {!isClone && (
            <div className="flex h-6 shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100">
              <Button
                variant="ghost"
                size="xs"
                className="size-6 p-0"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsEditing(true);
                  setTimeout(() => inputRef.current?.focus(), 0);
                }}
              >
                <Edit className="size-3" />
              </Button>
              <Button
                variant="ghost"
                size="xs"
                className="size-6 p-0 text-red-500 hover:text-red-600"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete?.(category.id);
                }}
              >
                <Trash className="size-3" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export const CategorySettingDialog = ({ children }: { children?: React.ReactNode }) => {
  const { t } = useTranslation('common');
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');

  const { data: categoryList } = useQuery({
    queryKey: ReactQueryKeys.templateCategoryList(),
    queryFn: () => getTemplateCategoryList().then((data) => data.data),
  });

  const [innerCategories, setInnerCategories] = useState<ITemplateCategoryListVo[]>([]);

  useEffect(() => {
    setInnerCategories(categoryList ?? []);
  }, [categoryList]);

  const { mutate: createCategoryFn } = useMutation({
    mutationFn: (name: string) => createTemplateCategory({ name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.templateCategoryList() });
      setNewCategoryName('');
    },
  });

  const { mutate: updateCategoryFn } = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      updateTemplateCategory(id, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.templateCategoryList() });
    },
  });

  const { mutate: deleteCategoryFn } = useMutation({
    mutationFn: (id: string) => deleteTemplateCategory(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.templateCategoryList() });
    },
  });

  const { mutateAsync: updateCategoryOrderFn } = useMutation({
    mutationFn: ({
      templateCategoryId,
      anchorId,
      position,
    }: {
      templateCategoryId: string;
      anchorId: string;
      position: 'before' | 'after';
    }) => updateTemplateCategoryOrder({ templateCategoryId, anchorId, position }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.templateCategoryList() });
    },
  });

  const handleAddCategory = () => {
    const trimmedName = newCategoryName.trim();
    if (!trimmedName) {
      toast.warning(t('settings.templateAdmin.tips.addCategoryTips'));
      return;
    }
    const isDuplicate = innerCategories.some(
      (category) => category.name.toLowerCase() === trimmedName.toLowerCase()
    );
    if (isDuplicate) {
      toast.warning(t('settings.templateAdmin.tips.duplicateCategoryName'));
      return;
    }
    createCategoryFn(trimmedName);
  };

  const onDragEnd = async (result: DropResult) => {
    const { source, destination } = result;

    if (!destination || source.index === destination.index) {
      return;
    }

    const list = [...innerCategories];
    const [category] = list.splice(source.index, 1);
    list.splice(destination.index, 0, category);
    setInnerCategories(list);

    const categoryIndex = list.findIndex((v) => v.id === category.id);
    if (categoryIndex === 0) {
      await updateCategoryOrderFn({
        templateCategoryId: category.id,
        anchorId: list[1].id,
        position: 'before',
      });
    } else {
      await updateCategoryOrderFn({
        templateCategoryId: category.id,
        anchorId: list[categoryIndex - 1].id,
        position: 'after',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children ?? (
          <Button size="xs" variant="outline" className="ml-1 size-6 p-0 hover:bg-accent">
            <Settings className="size-4" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('settings.templateAdmin.actions.manageCategory')}</DialogTitle>
        </DialogHeader>

        {/* Add new category */}
        <div className="flex items-center gap-2">
          <Input
            className="h-8 flex-1"
            placeholder={t('settings.templateAdmin.tips.categoryNamePlaceholder')}
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleAddCategory();
              }
            }}
          />
          <Button size="sm" className="h-8" onClick={handleAddCategory}>
            <Plus className="size-4" />
          </Button>
        </div>

        <div className="max-h-[400px] overflow-y-auto">
          {innerCategories.length > 0 ? (
            <DragDropContext onDragEnd={onDragEnd}>
              <Droppable
                droppableId="category-sort-list"
                renderClone={(provided, snapshot, rubric) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.draggableProps}
                    {...provided.dragHandleProps}
                  >
                    <CategoryDraggableItem
                      category={innerCategories[rubric.source.index]}
                      isDragging={snapshot.isDragging}
                      isClone
                    />
                  </div>
                )}
              >
                {(droppableProvided) => (
                  <div
                    {...droppableProvided.droppableProps}
                    ref={droppableProvided.innerRef}
                    className="space-y-2"
                  >
                    {innerCategories.map((category, index) => (
                      <Draggable key={category.id} draggableId={category.id} index={index}>
                        {(draggableProvided, draggableSnapshot) => (
                          <div
                            ref={draggableProvided.innerRef}
                            {...draggableProvided.draggableProps}
                            {...draggableProvided.dragHandleProps}
                          >
                            <CategoryDraggableItem
                              category={category}
                              isDragging={draggableSnapshot.isDragging}
                              onEdit={(id, name) => updateCategoryFn({ id, name })}
                              onDelete={deleteCategoryFn}
                            />
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {droppableProvided.placeholder}
                  </div>
                )}
              </Droppable>
            </DragDropContext>
          ) : (
            <div className="py-8 text-center text-sm text-muted-foreground">
              {t('settings.templateAdmin.noData')}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
