import { useQuery } from '@tanstack/react-query';
import { getChatMessages } from '@teable/openapi';
import { useChatStore } from '../store/useChatStore';

export const useChatMessages = (baseId: string) => {
  const { activeChatId } = useChatStore();

  const { data: chatMessage } = useQuery({
    queryKey: ['chat-message', activeChatId!],
    queryFn: ({ queryKey }) => getChatMessages(baseId, queryKey[1]).then((res) => res.data),
    enabled: Boolean(activeChatId),
  });

  return {
    chatMessage,
  };
};
