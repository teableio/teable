import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Star } from '@teable/icons';
import type { PinType } from '@teable/openapi';
import { addPin, deletePin } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  cn,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { spaceConfig } from '@/features/i18n/space.config';
import { usePinMap } from '../usePinMap';

interface IStarButtonProps {
  id: string;
  type: PinType;
  className?: string;
}

export const StarButton = (props: IStarButtonProps) => {
  const { className, id, type } = props;
  const queryClient = useQueryClient();
  const pinMap = usePinMap();
  const { t } = useTranslation(spaceConfig.i18nNamespaces);

  const isPin = pinMap?.[id];

  const { mutate: addPinMutation, isLoading: addPinLoading } = useMutation({
    mutationFn: addPin,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.pinList() });
    },
  });

  const { mutate: deletePinMutation, isLoading: deletePinLoading } = useMutation({
    mutationFn: deletePin,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.pinList() });
    },
  });

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger>
          <Star
            className={cn(
              'size-3 shrink-0 opacity-0 group-hover:opacity-100 transition-colors',
              {
                'opacity-100': isPin,
                'fill-yellow-400 text-yellow-400': isPin,
              },
              className
            )}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              if (addPinLoading || deletePinLoading) return;
              isPin ? deletePinMutation({ id, type }) : addPinMutation({ id, type });
            }}
          />
        </TooltipTrigger>
        <TooltipContent>
          <p>{isPin ? t('space:pin.remove') : t('space:pin.add')}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
