import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Star } from '@teable/icons';
import { addPin, deletePin, PinType } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { Button } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { tableConfig } from '@/features/i18n/table.config';
import { usePinMap } from '../../space/usePinMap';

export const PinViewItem = ({ viewId }: { viewId: string }) => {
  const queryClient = useQueryClient();
  const pinMap = usePinMap();
  const { t } = useTranslation(tableConfig.i18nNamespaces);

  const isPin = pinMap?.[viewId];

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
    <Button
      size="xs"
      variant="ghost"
      onClick={() => {
        if (addPinLoading || deletePinLoading) return;
        isPin
          ? deletePinMutation({ id: viewId, type: PinType.View })
          : addPinMutation({ id: viewId, type: PinType.View });
      }}
      className="flex justify-start"
    >
      <Star className="size-3 shrink-0" />
      {isPin ? t('space:pin.remove') : t('space:pin.add')}
    </Button>
  );
};
