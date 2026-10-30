import { TemplateListSort } from '@teable/openapi';
import { cn } from '@teable/ui-lib/shadcn';
import { useContext, useState } from 'react';
import { CategoryMenu } from './CategoryMenu';
import { TemplateHostContext } from './host-context';
import { TemplateList } from './TemplateList';

export interface ITemplateBaseProps {
  onClickUseTemplateHandler?: (templateId: string) => void;
  onClickTemplateCardHandler?: (template: string) => void;
}

/** Which slice of the catalogue the list shows: the host's default order, newest first, or the featured ones. */
export type ITemplateListing = 'featured' | 'newest';

interface ITemplateMainProps extends ITemplateBaseProps {
  currentCategoryId: string | null;
  search: string;
  onCategoryChange: (value: string | null) => void;
  categoryMenuClassName?: string;
  categoryHeaderRender?: () => React.ReactNode;
  className?: string;
  templateListClassName?: string;
}

export const TemplateMain = (props: ITemplateMainProps) => {
  const {
    currentCategoryId,
    search,
    onCategoryChange,
    onClickUseTemplateHandler,
    onClickTemplateCardHandler,
    categoryMenuClassName,
    categoryHeaderRender,
    className,
    templateListClassName,
  } = props;
  const host = useContext(TemplateHostContext);
  const [listing, setListing] = useState<ITemplateListing>('featured');
  const sort = listing === 'newest' ? TemplateListSort.Newest : host.catalogSort;
  return (
    <div className={cn('@container flex flex-1 flex-col overflow-hidden @5xl:flex-row', className)}>
      <CategoryMenu
        currentCategoryId={currentCategoryId}
        onCategoryChange={onCategoryChange}
        className={categoryMenuClassName}
        categoryHeaderRender={categoryHeaderRender}
      />
      <TemplateList
        currentCategoryId={currentCategoryId}
        search={search}
        onClickUseTemplateHandler={onClickUseTemplateHandler}
        onClickTemplateCardHandler={onClickTemplateCardHandler}
        className={cn(templateListClassName, 'p-4 shrink-0 content-start')}
        isFeatured={listing === 'featured' ? true : undefined}
        sort={sort}
        listing={listing}
        onListingChange={setListing}
      />
    </div>
  );
};
