import { useIsMobile } from '@teable/sdk/hooks';
import { cn } from '@teable/ui-lib/shadcn';
import { useState } from 'react';
import { CategoryMenu } from './CategoryMenu';
import { TemplateList } from './TemplateList';

export interface ITemplateBaseProps {
  onClickUseTemplateHandler?: (templateId: string) => void;
  onClickTemplateCardHandler?: (template: string) => void;
}

interface ITemplateMainProps extends ITemplateBaseProps {
  currentCategoryId: string | null;
  search: string;
  onCategoryChange: (value: string | null) => void;
  categoryMenuClassName?: string;
  categoryHeaderRender?: () => React.ReactNode;
  className?: string;
  templateListClassName?: string;
  disabledFeaturedToggle?: boolean;
}

export const TemplateMain = (props: ITemplateMainProps) => {
  const isMobile = useIsMobile();
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
    disabledFeaturedToggle = true,
  } = props;
  const [isFeatured, setIsFeatured] = useState<boolean | undefined>(true);
  return (
    <div
      className={cn('flex flex-1 overflow-hidden', className, {
        'flex-col': isMobile,
      })}
    >
      <CategoryMenu
        currentCategoryId={currentCategoryId}
        onCategoryChange={onCategoryChange}
        className={categoryMenuClassName}
        categoryHeaderRender={categoryHeaderRender}
        isFeatured={isFeatured}
        onFeaturedChange={setIsFeatured}
        disabledFeaturedToggle={disabledFeaturedToggle}
      />
      <TemplateList
        currentCategoryId={currentCategoryId}
        search={search}
        onClickUseTemplateHandler={onClickUseTemplateHandler}
        onClickTemplateCardHandler={onClickTemplateCardHandler}
        className={cn(templateListClassName, 'p-4 shrink-0 content-start')}
        isFeatured={isFeatured}
      />
    </div>
  );
};
