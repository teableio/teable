import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronsUpDown, Plus, Trash, Edit } from '@teable/icons';
import type { ITemplateCategoryListVo, IUpdateTemplateRo } from '@teable/openapi';
import {
  createTemplateCategory,
  deleteTemplateCategory,
  getTemplateCategoryList,
  updateTemplate,
  updateTemplateCategory,
} from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Button,
  cn,
  Input,
} from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { useTranslation } from 'next-i18next';
import { useMemo, useRef, useState } from 'react';

interface ITemplateCategorySelectProps {
  templateId: string;
  value?: string[];
  onChange: (ids: string[]) => void;
}

interface ICategoryCommandItemProps {
  selectedIds?: string[];
  onToggle: (id: string) => void;
  templateCategory: ITemplateCategoryListVo;
}

const CategoryCommandItem = (props: ICategoryCommandItemProps) => {
  const { selectedIds, onToggle, templateCategory } = props;
  const [isEditing, setIsEditing] = useState(false);
  const queryClient = useQueryClient();
  const { mutate: deleteTemplateCategoryFn } = useMutation({
    mutationFn: (id: string) => deleteTemplateCategory(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.templateCategoryList() });
    },
  });
  const { mutate: updateTemplateCategoryFn } = useMutation({
    mutationFn: (id: string) => updateTemplateCategory(id, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.templateCategoryList() });
      setIsEditing(false);
    },
  });
  const [name, setName] = useState(templateCategory.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const isSelected = selectedIds?.includes(templateCategory.id);

  return (
    <CommandItem
      key={templateCategory.id}
      value={templateCategory.name}
      onSelect={() => {
        onToggle(templateCategory.id);
      }}
      className="flex h-8 items-center justify-between gap-1"
    >
      {isEditing ? (
        <Input
          className="h-6"
          value={name}
          ref={inputRef}
          onChange={(e) => {
            setName(e.target.value);
          }}
          onBlur={(e) => {
            e.stopPropagation();
            if (name) {
              updateTemplateCategoryFn(templateCategory.id);
            }
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && name) {
              updateTemplateCategoryFn(templateCategory.id);
            }

            if (e.key === 'Escape') {
              setIsEditing(false);
            }
          }}
        />
      ) : (
        <div className="group flex size-full items-center justify-between gap-1">
          <span className="flex-1 truncate">{templateCategory.name}</span>
          <Button
            variant="outline"
            size={'xs'}
            className="hidden h-full group-hover:block"
            onClick={(e) => {
              e.stopPropagation();
              setIsEditing(true);
              setTimeout(() => {
                inputRef.current?.focus();
              }, 0);
            }}
          >
            <Edit className="size-3" />
          </Button>
          <Button
            variant="outline"
            size={'xs'}
            className="hidden h-full group-hover:block"
            onClick={(e) => {
              e.stopPropagation();
              deleteTemplateCategoryFn(templateCategory.id);
            }}
          >
            <Trash className="size-3 text-red-500" />
          </Button>
          <Check className={cn('shrink-0', isSelected ? 'block' : 'hidden')} />
        </div>
      )}
    </CommandItem>
  );
};

export const TemplateCategorySelect = (props: ITemplateCategorySelectProps) => {
  const { value = [], onChange, templateId } = props;
  const { t } = useTranslation('common');
  const queryClient = useQueryClient();
  const { data: templateCategoryList } = useQuery({
    queryKey: ReactQueryKeys.templateCategoryList(),
    queryFn: () => getTemplateCategoryList().then((data) => data.data),
  });

  const { mutateAsync: updateTemplateFn } = useMutation({
    mutationFn: ({ templateId, updateRo }: { templateId: string; updateRo: IUpdateTemplateRo }) =>
      updateTemplate(templateId, { ...updateRo }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.templateList() });
    },
  });

  const { mutate: createTemplateCategoryFn } = useMutation({
    mutationFn: (name: string) => createTemplateCategory({ name }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.templateCategoryList() });
      setSearchValue('');
      const newCategoryId = [...value, res.data.id];
      updateTemplateFn({ templateId, updateRo: { categoryId: newCategoryId } });
    },
  });

  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');

  const searchInList = useMemo(() => {
    return Boolean(templateCategoryList?.find((tmp) => tmp.name === searchValue));
  }, [templateCategoryList, searchValue]);

  const selectedCategories = useMemo(() => {
    return templateCategoryList?.filter((tmp) => value.includes(tmp.id)) || [];
  }, [templateCategoryList, value]);

  const handleToggleCategory = (categoryId: string) => {
    const newValue = value.includes(categoryId)
      ? value.filter((id) => id !== categoryId)
      : [...value, categoryId];
    onChange(newValue);
  };

  const displayText =
    selectedCategories.length > 0
      ? selectedCategories.map((cat) => cat.name).join(', ')
      : t('settings.templateAdmin.actions.selectCategory');

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-[200px] justify-between"
        >
          <span className="truncate text-xs">{displayText}</span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-0">
        <Command>
          <CommandInput
            value={searchValue}
            placeholder={t('actions.search')}
            onValueChange={(value) => setSearchValue(value)}
          />
          <CommandList className="w-full p-1">
            <CommandGroup className="p-0">
              {templateCategoryList?.map((tmp) => (
                <CategoryCommandItem
                  key={tmp.id}
                  templateCategory={tmp}
                  onToggle={handleToggleCategory}
                  selectedIds={value}
                />
              ))}
            </CommandGroup>

            {!searchInList && (
              <Button
                className="mt-1 flex w-full justify-center gap-1"
                variant="ghost"
                size={'xs'}
                onClick={() => {
                  if (!searchValue) {
                    toast.warning(t('settings.templateAdmin.tips.addCategoryTips'));
                  } else {
                    createTemplateCategoryFn(searchValue);
                  }
                }}
              >
                <Plus className="size-4 shrink-0" />
                <span className="truncate" title={searchValue}>
                  {t('settings.templateAdmin.actions.addCategory')}
                  <span className="ml-2 text-sm text-gray-500">
                    {searchValue ? `"${searchValue}"` : ''}
                  </span>
                </span>
              </Button>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};
