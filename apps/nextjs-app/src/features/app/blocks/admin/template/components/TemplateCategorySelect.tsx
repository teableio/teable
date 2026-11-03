import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronRight, ChevronsUpDown, Plus, Search } from '@teable/icons';
import type { ICreateTemplateCategoryRo, ITemplateCategoryListVo } from '@teable/openapi';
import {
  createTemplateCategory,
  getTemplateCategoryList,
  groupTemplateCategories,
  TemplateCategoryKind,
} from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import {
  Button,
  cn,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { useTranslation } from 'next-i18next';
import { useEffect, useMemo, useRef, useState } from 'react';

interface ITemplateCategorySelectProps {
  value?: string[];
  onChange: (ids: string[]) => void;
}

interface ICategoryRowProps {
  label: string;
  selected: boolean;
  active?: boolean;
  hasChildren?: boolean;
  hasSelectedChild?: boolean;
  onClick: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

const CategoryRow = (props: ICategoryRowProps) => {
  const {
    label,
    selected,
    active,
    hasChildren,
    hasSelectedChild,
    onClick,
    onMouseEnter,
    onMouseLeave,
  } = props;
  return (
    <button
      type="button"
      className={cn('flex h-8 w-full items-center gap-1 rounded-sm px-2 text-sm hover:bg-accent', {
        'bg-accent': active,
      })}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <span className="flex-1 truncate text-start">{label}</span>
      {hasSelectedChild && <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground" />}
      {selected && <Check className="size-4 shrink-0" />}
      {hasChildren && <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
    </button>
  );
};

interface IFooterButtonProps {
  children: React.ReactNode;
  onClick: () => void;
}

const FooterButton = ({ children, onClick }: IFooterButtonProps) => (
  <button
    type="button"
    className="flex h-8 shrink-0 items-center gap-1 border-t px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
    onClick={onClick}
  >
    <Plus className="size-3.5 shrink-0" />
    <span className="truncate">{children}</span>
  </button>
);

interface INewCategoryFormProps {
  kind?: TemplateCategoryKind;
  parent?: ITemplateCategoryListVo;
  initialName: string;
  pending: boolean;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}

const NewCategoryForm = (props: INewCategoryFormProps) => {
  const { kind, parent, initialName, pending, onSubmit, onCancel } = props;
  const { t } = useTranslation('common');
  const [name, setName] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  const trimmed = name.trim();
  const canSubmit = Boolean(trimmed) && !pending;
  const isTeam = kind === TemplateCategoryKind.Team;
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="truncate text-sm font-medium">
        {parent
          ? t('settings.templateAdmin.actions.addSubCategoryUnder', { name: parent.name })
          : t(
              isTeam
                ? 'settings.templateAdmin.actions.addTeam'
                : 'settings.templateAdmin.actions.addCategory'
            )}
      </div>
      <Input
        ref={inputRef}
        className="h-8"
        value={name}
        placeholder={t(
          parent
            ? 'settings.templateAdmin.tips.subCategoryNamePlaceholder'
            : isTeam
              ? 'settings.templateAdmin.tips.teamNamePlaceholder'
              : 'settings.templateAdmin.tips.categoryNamePlaceholder'
        )}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && canSubmit) onSubmit(trimmed);
        }}
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t('actions.cancel')}
        </Button>
        <Button size="sm" disabled={!canSubmit} onClick={() => onSubmit(trimmed)}>
          {t('actions.create')}
        </Button>
      </div>
    </div>
  );
};

interface IDraft {
  /** Omitted: an industry. */
  kind?: TemplateCategoryKind;
  parentId?: string;
  name: string;
}

export const TemplateCategorySelect = (props: ITemplateCategorySelectProps) => {
  const { value = [], onChange } = props;
  const { t } = useTranslation('common');
  const queryClient = useQueryClient();
  const { data: categories = [] } = useQuery({
    queryKey: ReactQueryKeys.templateCategoryList(),
    queryFn: () => getTemplateCategoryList().then((data) => data.data),
  });

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState(TemplateCategoryKind.Industry);
  const [activeId, setActiveId] = useState<string>();
  const [draft, setDraft] = useState<IDraft>();
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const {
    industries: roots,
    teams,
    childrenOf,
  } = useMemo(() => groupTemplateCategories(categories), [categories]);
  const activeRoot = roots.find((root) => root.id === activeId) ?? roots[0];
  const activeChildren = activeRoot ? childrenOf(activeRoot.id) : [];

  const { mutate: createCategory, isPending } = useMutation({
    mutationFn: (ro: ICreateTemplateCategoryRo) => createTemplateCategory(ro),
    onSuccess: async (res, ro) => {
      await queryClient.invalidateQueries({ queryKey: ReactQueryKeys.templateCategoryList() });
      setDraft(undefined);
      if (ro.kind !== TemplateCategoryKind.Team) setActiveId(ro.parentId ?? res.data.id);
      onChange([...value, res.data.id]);
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const label = (category: ITemplateCategoryListVo) => {
    const parent = category.parentId ? byId.get(category.parentId) : undefined;
    return parent ? `${parent.name} / ${category.name}` : category.name;
  };
  const selectedText = value
    .flatMap((id) => {
      const category = byId.get(id);
      return category ? [label(category)] : [];
    })
    .join(', ');

  // A template is tagged with a sub-industry; an industry row only opens its sub-industries,
  // unless it has none yet or the tag is already there and needs to come off.
  const canToggle = (category: ITemplateCategoryListVo) =>
    Boolean(category.parentId) ||
    value.includes(category.id) ||
    childrenOf(category.id).length === 0;
  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  // A short pause before switching, so a cursor crossing rows on its way to the
  // sub-industry column does not drag the column along.
  const onRootHover = (root: ITemplateCategoryListVo) => {
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setActiveId(root.id), 120);
  };
  const onRootLeave = () => clearTimeout(hoverTimer.current);
  const onRootClick = (root: ITemplateCategoryListVo) => {
    clearTimeout(hoverTimer.current);
    setActiveId(root.id);
    if (canToggle(root)) toggle(root.id);
  };

  const keyword = search.trim().toLowerCase();
  const matches = keyword
    ? categories.filter((c) => canToggle(c) && label(c).toLowerCase().includes(keyword))
    : [];

  const submitDraft = (name: string) => {
    if (categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      toast.warning(t('settings.templateAdmin.tips.duplicateCategoryName'));
      return;
    }
    createCategory({ name, parentId: draft?.parentId, kind: draft?.kind });
  };

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setSearch('');
      setDraft(undefined);
    }
  };

  return (
    <Popover modal open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-[200px] justify-between"
        >
          <span className={cn('truncate text-xs', { 'text-muted-foreground': !selectedText })}>
            {selectedText || t('settings.templateAdmin.actions.selectCategory')}
          </span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 p-0"
        onEscapeKeyDown={(e) => {
          if (!draft) return;
          e.preventDefault();
          setDraft(undefined);
        }}
      >
        {draft ? (
          <NewCategoryForm
            kind={draft.kind}
            parent={draft.parentId ? byId.get(draft.parentId) : undefined}
            initialName={draft.name}
            pending={isPending}
            onSubmit={submitDraft}
            onCancel={() => setDraft(undefined)}
          />
        ) : (
          <>
            <div className="flex items-center gap-2 border-b px-3">
              <Search className="size-4 shrink-0 text-muted-foreground" />
              <input
                className="h-9 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                value={search}
                placeholder={t('actions.search')}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {keyword ? (
              <div className="flex flex-col">
                <div className="max-h-60 overflow-y-auto p-1">
                  {matches.length ? (
                    matches.map((category) => (
                      <CategoryRow
                        key={category.id}
                        label={label(category)}
                        selected={value.includes(category.id)}
                        onClick={() => toggle(category.id)}
                      />
                    ))
                  ) : (
                    <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                      {t('noResult')}
                    </div>
                  )}
                </div>
                <FooterButton onClick={() => setDraft({ name: search.trim() })}>
                  {t('settings.templateAdmin.actions.addCategory')}
                </FooterButton>
              </div>
            ) : (
              <div className="flex flex-col">
                <Tabs
                  size="sm"
                  className="border-b p-1"
                  value={kind}
                  onValueChange={(v) => setKind(v as TemplateCategoryKind)}
                >
                  <TabsList>
                    <TabsTrigger value={TemplateCategoryKind.Industry}>
                      {t('settings.templateAdmin.actions.industries')}
                    </TabsTrigger>
                    <TabsTrigger value={TemplateCategoryKind.Team}>
                      {t('settings.templateAdmin.actions.teams')}
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
                {kind === TemplateCategoryKind.Team ? (
                  <>
                    <div className="max-h-60 flex-1 overflow-y-auto p-1">
                      {teams.map((team) => (
                        <CategoryRow
                          key={team.id}
                          label={team.name}
                          selected={value.includes(team.id)}
                          onClick={() => toggle(team.id)}
                        />
                      ))}
                    </div>
                    <FooterButton
                      onClick={() => setDraft({ kind: TemplateCategoryKind.Team, name: '' })}
                    >
                      {t('settings.templateAdmin.actions.addTeam')}
                    </FooterButton>
                  </>
                ) : (
                  <div className="grid grid-cols-2">
                    <div className="flex flex-col border-e">
                      <div className="max-h-60 flex-1 overflow-y-auto p-1">
                        {roots.map((root) => {
                          const children = childrenOf(root.id);
                          return (
                            <CategoryRow
                              key={root.id}
                              label={root.name}
                              active={root.id === activeRoot?.id}
                              selected={value.includes(root.id)}
                              hasChildren={children.length > 0}
                              hasSelectedChild={children.some((c) => value.includes(c.id))}
                              onClick={() => onRootClick(root)}
                              onMouseEnter={children.length ? () => onRootHover(root) : undefined}
                              onMouseLeave={onRootLeave}
                            />
                          );
                        })}
                      </div>
                      <FooterButton onClick={() => setDraft({ name: '' })}>
                        {t('settings.templateAdmin.actions.addCategory')}
                      </FooterButton>
                    </div>
                    <div className="flex flex-col">
                      <div className="max-h-60 flex-1 overflow-y-auto p-1">
                        {activeChildren.map((child) => (
                          <CategoryRow
                            key={child.id}
                            label={child.name}
                            selected={value.includes(child.id)}
                            onClick={() => toggle(child.id)}
                          />
                        ))}
                        {activeRoot && !activeChildren.length && (
                          <div className="px-2 py-3 text-xs text-muted-foreground">
                            {t('settings.templateAdmin.tips.noSubCategory')}
                          </div>
                        )}
                      </div>
                      {activeRoot && (
                        <FooterButton
                          onClick={() => setDraft({ parentId: activeRoot.id, name: '' })}
                        >
                          {t('settings.templateAdmin.actions.addSubCategory')}
                        </FooterButton>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
};
