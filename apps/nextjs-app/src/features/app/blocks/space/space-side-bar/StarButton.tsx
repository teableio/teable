import { Star } from '@teable/icons';
import type { PinType } from '@teable/openapi';
import {
  Tooltip,
  TooltipContent,
  TooltipPortal,
  TooltipProvider,
  TooltipTrigger,
  cn,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { spaceConfig } from '@/features/i18n/space.config';
import { usePinActions } from '../usePinActions';

interface IStarButtonProps {
  id: string;
  type: PinType;
  className?: string;
}

export const StarButton = (props: IStarButtonProps) => {
  const { className, id, type } = props;
  const { t } = useTranslation(spaceConfig.i18nNamespaces);
  const { isPinned, togglePin } = usePinActions();
  const isPin = isPinned(id);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            togglePin(id, type);
          }}
        >
          <Star
            className={cn(
              'size-4 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-colors',
              {
                'opacity-100': isPin,
                'fill-yellow-400 text-yellow-400': isPin,
              },
              className
            )}
          />
        </TooltipTrigger>
        {/* Portalled: a sidebar or scroll area around the button would clip it. */}
        <TooltipPortal>
          <TooltipContent>
            <p>{isPin ? t('space:pin.remove') : t('space:pin.add')}</p>
          </TooltipContent>
        </TooltipPortal>
      </Tooltip>
    </TooltipProvider>
  );
};
