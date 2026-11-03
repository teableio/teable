import type { DropResult } from '@hello-pangea/dnd';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DraggableHandle, Settings, Plus, Edit, Trash } from '@teable/icons';
import type { ITemplateCategoryListVo, IUpdateTemplateCategoryRo } from '@teable/openapi';
import {
  createTemplateCategory,
  deleteTemplateCategory,
  getTemplateCategoryList,
  groupTemplateCategories,
  TemplateCategoryKind,
  updateTemplateCategory,
  updateTemplateCategoryOrder,
  URL_KEY_MAX_LENGTH,
  URL_KEY_PATTERN,
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
import { useState, useEffect, useRef, useMemo } from 'react';

const ROOT_DROPPABLE = 'category-industries';
const TEAM_DROPPABLE = 'category-teams';
const CHILD_DROPPABLE_PREFIX = 'category-children-';

type IOnEdit = (vars: { id: string; ro: IUpdateTemplateCategoryRo }) => void;

const CategoryDraggableItem = ({
  category,
  isDragging,
  onEdit,
  onDelete,
  onAddChild,
}: {
  category: ITemplateCategoryListVo;
  isDragging?: boolean;
  onEdit: IOnEdit;
  onDelete: (id: string) => void;
  onAddChild?: () => void;
}) => {
  const { t } = useTranslation('common');
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const [key, setKey] = useState(category.key ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSave = () => {
    const nextKey = key.trim();
    if (nextKey && !URL_KEY_PATTERN.test(nextKey)) {
      toast.warning(t('settings.templateAdmin.tips.invalidKey'));
      return;
    }
    const ro: IUpdateTemplateCategoryRo = {};
    if (name && name !== category.name) ro.name = name;
    if (nextKey !== (category.key ?? '')) ro.key = nextKey || null;
    if (Object.keys(ro).length) onEdit({ id: category.id, ro });
    setIsEditing(false);
  };
  const cancel = () => {
    setName(category.name);
    setKey(category.key ?? '');
    setIsEditing(false);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') cancel();
  };

  return (
    <div
      className={cn('group flex items-center gap-2 rounded-md border bg-background px-3 py-2', {
        'opacity-50': isDragging,
      })}
    >
      <DraggableHandle className="size-4 shrink-0 cursor-grab text-gray-400 active:cursor-grabbing" />
      {isEditing ? (
        <div
          className="flex flex-1 items-center gap-2"
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) handleSave();
          }}
        >
          <Input
            className="h-6 flex-1 py-0"
            value={name}
            ref={inputRef}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <Input
            className="h-6 w-32 py-0 font-mono text-xs"
            value={key}
            maxLength={URL_KEY_MAX_LENGTH}
            placeholder={t('settings.templateAdmin.tips.keyPlaceholder')}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
      ) : (
        <>
          <span className="flex h-6 flex-1 items-center gap-2 truncate text-sm">
            <span className="truncate">{category.name}</span>
            {category.key && (
              <span className="truncate font-mono text-xs text-muted-foreground">
                /{category.key}
              </span>
            )}
          </span>
          <div className="flex h-6 shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100">
            {onAddChild && (
              <Button
                variant="ghost"
                size="xs"
                className="h-6 px-1.5"
                title={t('settings.templateAdmin.actions.addSubCategory')}
                onClick={(e) => {
                  e.stopPropagation();
                  onAddChild();
                }}
              >
                <Plus className="size-3" />
              </Button>
            )}
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
                onDelete(category.id);
              }}
            >
              <Trash className="size-3" />
            </Button>
          </div>
        </>
      )}
    </div>
  );
};

/** One level with no children under it: sub-industries of an industry, or the teams. */
const FlatCategoryList = ({
  droppableId,
  type,
  categories,
  onEdit,
  onDelete,
}: {
  droppableId: string;
  type: string;
  categories: ITemplateCategoryListVo[];
  onEdit: IOnEdit;
  onDelete: (id: string) => void;
}) => (
  <Droppable droppableId={droppableId} type={type}>
    {(provided) => (
      <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-1">
        {categories.map((category, index) => (
          <Draggable key={category.id} draggableId={category.id} index={index}>
            {(draggable, snapshot) => (
              <div
                ref={draggable.innerRef}
                {...draggable.draggableProps}
                {...draggable.dragHandleProps}
              >
                <CategoryDraggableItem
                  category={category}
                  isDragging={snapshot.isDragging}
                  onEdit={onEdit}
                  onDelete={onDelete}
                />
              </div>
            )}
          </Draggable>
        ))}
        {provided.placeholder}
      </div>
    )}
  </Droppable>
);

const NewCategoryInput = ({
  placeholder,
  focusOnMount,
  onSubmit,
  onCancel,
}: {
  placeholder: string;
  focusOnMount?: boolean;
  onSubmit: (name: string) => void;
  onCancel?: () => void;
}) => {
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusOnMount) inputRef.current?.focus();
  }, [focusOnMount]);
  return (
    <div className="flex items-center gap-2">
      <Input
        ref={inputRef}
        className="flex-1"
        placeholder={placeholder}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            onSubmit(name);
            setName('');
          }
          if (e.key === 'Escape') {
            onCancel?.();
          }
        }}
      />
      <Button
        size="icon-sm"
        onClick={() => {
          onSubmit(name);
          setName('');
        }}
      >
        <Plus className="size-4 shrink-0" />
      </Button>
    </div>
  );
};

/**
 * Industries, each with its sub-industries under it, and teams as a flat list; ordering stays
 * within one level. Each row also carries the key that names it in public URLs.
 */
export const CategorySettingDialog = ({ children }: { children?: React.ReactNode }) => {
  const { t } = useTranslation('common');
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [addingUnder, setAddingUnder] = useState<string | null>(null);

  const { data: categoryList } = useQuery({
    queryKey: ReactQueryKeys.templateCategoryList(),
    queryFn: () => getTemplateCategoryList().then((data) => data.data),
  });

  const [innerCategories, setInnerCategories] = useState<ITemplateCategoryListVo[]>([]);

  useEffect(() => {
    setInnerCategories(categoryList ?? []);
  }, [categoryList]);

  const {
    industries: roots,
    teams,
    childrenOf,
  } = useMemo(() => groupTemplateCategories(innerCategories), [innerCategories]);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ReactQueryKeys.templateCategoryList() });

  const { mutate: createCategoryFn } = useMutation({
    mutationFn: (ro: { name: string; parentId?: string; kind?: TemplateCategoryKind }) =>
      createTemplateCategory(ro),
    onSuccess: () => {
      invalidate();
      setAddingUnder(null);
    },
  });

  const { mutate: updateCategoryFn } = useMutation({
    mutationFn: ({ id, ro }: { id: string; ro: IUpdateTemplateCategoryRo }) =>
      updateTemplateCategory(id, ro),
    onSuccess: invalidate,
  });

  const { mutate: deleteCategoryFn } = useMutation({
    mutationFn: (id: string) => deleteTemplateCategory(id),
    onSuccess: invalidate,
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
    onSuccess: invalidate,
  });

  /** Omitted kind: an industry. */
  const handleAddCategory = (
    name: string,
    opts: { kind?: TemplateCategoryKind; parentId?: string } = {}
  ) => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.warning(
        t(
          opts.kind === TemplateCategoryKind.Team
            ? 'settings.templateAdmin.tips.addTeamTips'
            : 'settings.templateAdmin.tips.addCategoryTips'
        )
      );
      return;
    }
    const isDuplicate = innerCategories.some(
      (category) => category.name.toLowerCase() === trimmedName.toLowerCase()
    );
    if (isDuplicate) {
      toast.warning(t('settings.templateAdmin.tips.duplicateCategoryName'));
      return;
    }
    createCategoryFn({ name: trimmedName, ...opts });
  };

  const siblingsOf = (droppableId: string) => {
    if (droppableId === ROOT_DROPPABLE) return roots;
    if (droppableId === TEAM_DROPPABLE) return teams;
    return childrenOf(droppableId.slice(CHILD_DROPPABLE_PREFIX.length));
  };

  const onDragEnd = async (result: DropResult) => {
    const { source, destination } = result;
    // A row only moves among its siblings: an industry stays an industry, a sub-industry stays
    // under its industry, a team stays a team.
    if (
      !destination ||
      destination.droppableId !== source.droppableId ||
      source.index === destination.index
    ) {
      return;
    }
    const list = [...siblingsOf(source.droppableId)];
    const [category] = list.splice(source.index, 1);
    list.splice(destination.index, 0, category);
    const siblingIds = new Set(list.map((c) => c.id));
    setInnerCategories((prev) => [...prev.filter((c) => !siblingIds.has(c.id)), ...list]);

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
          <Button size="icon-xs" variant="outline" className="ms-1 size-6 p-0 hover:bg-accent">
            <Settings className="size-4 shrink-0" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('settings.templateAdmin.actions.manageCategory')}</DialogTitle>
        </DialogHeader>

        <DragDropContext onDragEnd={onDragEnd}>
          <div className="max-h-[520px] space-y-5 overflow-y-auto">
            <section className="space-y-2">
              <h3 className="text-xs font-medium text-muted-foreground">
                {t('settings.templateAdmin.actions.industries')}
              </h3>
              <NewCategoryInput
                placeholder={t('settings.templateAdmin.tips.categoryNamePlaceholder')}
                onSubmit={(name) => handleAddCategory(name)}
              />
              <Droppable droppableId={ROOT_DROPPABLE} type="industry">
                {(droppableProvided) => (
                  <div
                    {...droppableProvided.droppableProps}
                    ref={droppableProvided.innerRef}
                    className="space-y-2"
                  >
                    {roots.map((root, index) => {
                      const subs = childrenOf(root.id);
                      return (
                        <Draggable key={root.id} draggableId={root.id} index={index}>
                          {(draggableProvided, draggableSnapshot) => (
                            <div
                              ref={draggableProvided.innerRef}
                              {...draggableProvided.draggableProps}
                              className="space-y-1"
                            >
                              <div {...draggableProvided.dragHandleProps}>
                                <CategoryDraggableItem
                                  category={root}
                                  isDragging={draggableSnapshot.isDragging}
                                  onEdit={updateCategoryFn}
                                  onDelete={deleteCategoryFn}
                                  onAddChild={() => setAddingUnder(root.id)}
                                />
                              </div>
                              {(subs.length > 0 || addingUnder === root.id) && (
                                <div className="ms-6 space-y-1">
                                  <FlatCategoryList
                                    droppableId={`${CHILD_DROPPABLE_PREFIX}${root.id}`}
                                    type={`sub-${root.id}`}
                                    categories={subs}
                                    onEdit={updateCategoryFn}
                                    onDelete={deleteCategoryFn}
                                  />
                                  {addingUnder === root.id && (
                                    <NewCategoryInput
                                      focusOnMount
                                      placeholder={t(
                                        'settings.templateAdmin.tips.subCategoryNamePlaceholder'
                                      )}
                                      onSubmit={(name) =>
                                        handleAddCategory(name, { parentId: root.id })
                                      }
                                      onCancel={() => setAddingUnder(null)}
                                    />
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </Draggable>
                      );
                    })}
                    {droppableProvided.placeholder}
                  </div>
                )}
              </Droppable>
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-medium text-muted-foreground">
                {t('settings.templateAdmin.actions.teams')}
              </h3>
              <NewCategoryInput
                placeholder={t('settings.templateAdmin.tips.teamNamePlaceholder')}
                onSubmit={(name) => handleAddCategory(name, { kind: TemplateCategoryKind.Team })}
              />
              <FlatCategoryList
                droppableId={TEAM_DROPPABLE}
                type="team"
                categories={teams}
                onEdit={updateCategoryFn}
                onDelete={deleteCategoryFn}
              />
            </section>
          </div>
        </DragDropContext>
      </DialogContent>
    </Dialog>
  );
};
