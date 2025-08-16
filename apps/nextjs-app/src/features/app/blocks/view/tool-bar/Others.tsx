import { ArrowUpRight, Code2, MoreHorizontal } from '@teable/icons';
import { useBaseId, useTableId, useTablePermission } from '@teable/sdk/hooks';
import { Button, cn, Popover, PopoverContent, PopoverTrigger } from '@teable/ui-lib/shadcn';
import { SearchButton } from '../search/SearchButton';
import { PersonalViewSwitch } from './components';
import { SharePopover } from './SharePopover';
import { ToolBarButton } from './ToolBarButton';

const OthersList = ({
  classNames,
  className,
}: {
  classNames?: { textClassName?: string; buttonClassName?: string };
  className?: string;
}) => {
  const permission = useTablePermission();
  const baseId = useBaseId() as string;
  const tableId = useTableId() as string;

  const { textClassName, buttonClassName } = classNames ?? {};

  const onAPIClick = () => {
    const path = `/developer/tool/query-builder`;
    const url = new URL(path, window.location.origin);
    url.searchParams.set('baseId', baseId);
    url.searchParams.set('tableId', tableId);

    window.open(url.toString(), '_blank');
  };

  return (
    <div className={cn('gap-1', className)}>
      <SharePopover>
        {(text, isActive) => (
          <ToolBarButton
            isActive={isActive}
            text={text}
            textClassName={textClassName}
            className={buttonClassName}
            disabled={!permission['view|update']}
          >
            <ArrowUpRight className="size-4" />
          </ToolBarButton>
        )}
      </SharePopover>
      <ToolBarButton
        text="API"
        className={buttonClassName}
        textClassName={textClassName}
        onClick={onAPIClick}
      >
        <Code2 className="size-4" />
      </ToolBarButton>
      <PersonalViewSwitch textClassName={textClassName} buttonClassName={buttonClassName} />
    </div>
  );
};

const OthersMenu = ({ className }: { className?: string }) => {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={'ghost'}
          size={'xs'}
          className={cn('font-normal shrink-0 truncate', className)}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-40 p-0">
        <OthersList
          className="flex flex-col"
          classNames={{ textClassName: 'inline', buttonClassName: 'justify-start rounded-none' }}
        />
      </PopoverContent>
    </Popover>
  );
};

export const Others: React.FC = () => {
  return (
    <div className="flex flex-1 justify-end @container/toolbar-others md:gap-1">
      <SearchButton />
      <OthersList
        className="hidden @md/toolbar:flex"
        classNames={{ textClassName: '@[300px]/toolbar-others:inline' }}
      />
      <OthersMenu className="@md/toolbar:hidden" />
    </div>
  );
};
