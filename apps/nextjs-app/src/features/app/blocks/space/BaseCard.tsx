import { Database, MoreHorizontal } from '@teable-group/icons';
import type { BaseSchema } from '@teable-group/openapi';
import { Button, Card, CardContent } from '@teable-group/ui-lib/shadcn';
import classNames from 'classnames';
import { useRouter } from 'next/router';
import type { FC } from 'react';

interface IBaseCard {
  base: BaseSchema.IGetBaseVo;
  className?: string;
}

export const BaseCard: FC<IBaseCard> = (props) => {
  const { base, className } = props;
  const router = useRouter();

  const moreClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  const intoBase = () => {
    router.push({
      pathname: '/base/[baseId]',
      query: {
        baseId: base.id,
      },
    });
  };

  return (
    <Card className={classNames('group cursor-pointer', className)} onClick={intoBase}>
      <CardContent className="w-full h-full flex items-center px-4 py-6">
        <Database className="min-w-[3.5rem] w-14 h-14" />
        <div className="flex-1 h-full overflow-hidden">
          <div className="flex justify-between items-center">
            <h3 className="line-clamp-2 flex-1 px-4	">{base.name}</h3>
            <Button
              className="p-0 w-5 h-5 opacity-0 group-hover:opacity-100"
              variant={'ghost'}
              size={'sm'}
              onClick={moreClick}
            >
              <MoreHorizontal />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
