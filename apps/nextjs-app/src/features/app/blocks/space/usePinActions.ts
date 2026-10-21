import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { PinType } from '@teable/openapi';
import { addPin, deletePin } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { usePinMap } from './usePinMap';

/** Whether a resource is pinned, and the toggle every pin button and menu item shares. */
export const usePinActions = () => {
  const queryClient = useQueryClient();
  const pinMap = usePinMap();
  const onSuccess = () => queryClient.invalidateQueries({ queryKey: ReactQueryKeys.pinList() });
  const { mutate: add, isPending: adding } = useMutation({ mutationFn: addPin, onSuccess });
  const { mutate: remove, isPending: removing } = useMutation({ mutationFn: deletePin, onSuccess });

  const isPinned = (id: string) => Boolean(pinMap?.[id]);
  const togglePin = (id: string, type: PinType) => {
    if (adding || removing) return;
    if (isPinned(id)) remove({ id, type });
    else add({ id, type });
  };
  return { isPinned, togglePin };
};
