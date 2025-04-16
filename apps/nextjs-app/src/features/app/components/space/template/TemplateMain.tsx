import { cn } from '@teable/ui-lib/shadcn';
import { CategoryMenu } from './CategoryMenu';
import { TemplateList } from './TemplateList';

export interface ITemplateBaseProps {
  onClickUseTemplateHandler?: (templateId: string) => void;
  onClickTemplateCardHandler?: (template: string) => void;
}

interface ITemplateMainProps extends ITemplateBaseProps {
  currentCategoryId: string;
  search: string;
  onCategoryChange: (value: string) => void;
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
  return (
    <div className={cn('flex flex-1 overflow-hidden', className)}>
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
        className={templateListClassName}
      />
    </div>
  );
};
