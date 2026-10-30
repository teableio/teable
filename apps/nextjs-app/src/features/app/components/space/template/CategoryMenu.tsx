import { useQuery } from '@tanstack/react-query';
import {
  getTemplateCategoryList,
  groupTemplateCategories,
  TemplateCategoryKind,
} from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { cn } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { Fragment, useMemo } from 'react';
import { CategoryMenuItem } from './CategoryMenuItem';

interface ICategoryMenuProps {
  currentCategoryId: string | null;
  onCategoryChange: (category: string | null) => void;
  className?: string;
  categoryHeaderRender?: () => React.ReactNode;
}

export const CategoryMenu = (props: ICategoryMenuProps) => {
  const { currentCategoryId, onCategoryChange, className } = props;
  const { t } = useTranslation('common');
  const { data: categoryListFromServer } = useQuery({
    queryKey: ReactQueryKeys.publishedTemplateCategoryList(),
    queryFn: () => getTemplateCategoryList().then((data) => data.data),
  });

  // Industries, each with its sub-industries; the active industry (or the active sub-industry's)
  // unfolds. Teams are a flat list below them.
  const { roots, teams, activeRootId, activeChildren } = useMemo(() => {
    const list = categoryListFromServer ?? [];
    const { industries, teams, childrenOf } = groupTemplateCategories(list);
    const current = list.find((c) => c.id === currentCategoryId);
    const activeRootId =
      current?.kind === TemplateCategoryKind.Industry ? (current.parentId ?? current.id) : null;
    return {
      roots: industries,
      teams,
      activeRootId,
      activeChildren: activeRootId ? childrenOf(activeRootId) : [],
    };
  }, [categoryListFromServer, currentCategoryId]);

  const item = (id: string | null, name: string, itemClassName?: string) => (
    <CategoryMenuItem
      key={id ?? 'all'}
      category={name}
      id={id}
      currentCategoryId={currentCategoryId}
      onClickHandler={() => onCategoryChange(id)}
      className={itemClassName}
    />
  );

  return (
    <div
      className={cn(
        'flex w-full shrink-0 flex-col gap-0.5 px-4 pt-4 @5xl:w-56 @5xl:overflow-y-auto @5xl:px-2',
        className
      )}
    >
      <div className="flex gap-0.5 overflow-x-auto @5xl:flex-col @5xl:overflow-visible">
        {item(null, t('settings.templateAdmin.category.menu.all'))}
        {roots.map((root) => (
          <Fragment key={root.id}>
            {item(root.id, root.name)}
            {root.id === activeRootId &&
              activeChildren.map((child) =>
                item(child.id, child.name, 'hidden @5xl:flex @5xl:ps-6')
              )}
          </Fragment>
        ))}
        {teams.length > 0 && (
          <div className="hidden px-2 pb-1 pt-3 text-xs text-muted-foreground @5xl:block">
            {t('settings.templateAdmin.category.menu.byTeam')}
          </div>
        )}
        {teams.map((team) => item(team.id, team.name))}
      </div>
      {activeChildren.length > 0 && (
        <div className="flex gap-0.5 overflow-x-auto @5xl:hidden">
          {activeChildren.map((child) => item(child.id, child.name))}
        </div>
      )}
    </div>
  );
};
