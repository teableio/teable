import { ArrowUpRight, Code2, Database, MoreHorizontal } from '@teable/icons';
import { useBaseId, useTableId, useTablePermission } from '@teable/sdk/hooks';
import { Button, cn, Popover, PopoverContent, PopoverTrigger } from '@teable/ui-lib/shadcn';
import Link from 'next/link';
import { useTranslation } from 'next-i18next';
import { GUIDE_API_BUTTON } from '@/components/Guide';
import { DbConnectionPanelTrigger } from '../../db-connection/PanelTrigger';
import { SearchButton } from '../search/SearchButton';
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
  const { t } = useTranslation('table');
  const baseId = useBaseId() as string;
  const tableId = useTableId();

  return (
    <div className={cn('gap-1', className)}>
      <SharePopover>
        {(text, isActive) => (
          <ToolBarButton
            isActive={isActive}
            text={text}
            textClassName={classNames?.textClassName}
            className={classNames?.buttonClassName}
            disabled={!permission['view|update']}
          >
            <ArrowUpRight className="size-4" />
          </ToolBarButton>
        )}
      </SharePopover>
      <Popover>
        <PopoverTrigger asChild>
          <ToolBarButton
            text="API"
            className={cn(GUIDE_API_BUTTON, classNames?.buttonClassName)}
            textClassName={classNames?.textClassName}
          >
            <Code2 className="size-4" />
          </ToolBarButton>
        </PopoverTrigger>
        <PopoverContent side="bottom" align="start" className="w-48 p-0">
          <Button
            variant={'ghost'}
            size={'xs'}
            className="w-full justify-start font-normal"
            asChild
          >
            <Link
              href={{
                pathname: '/developer/tool/query-builder',
                query: { baseId, tableId },
              }}
              target="_blank"
            >
              <Code2 className="size-4" />
              {t('toolbar.others.api.restfulApi')}
            </Link>
          </Button>
          <DbConnectionPanelTrigger>
            <Button variant={'ghost'} size={'xs'} className="w-full justify-start font-normal">
              <Database className="pr-1 text-lg" />
              {t('toolbar.others.api.databaseConnection')}
            </Button>
          </DbConnectionPanelTrigger>
        </PopoverContent>
      </Popover>
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
