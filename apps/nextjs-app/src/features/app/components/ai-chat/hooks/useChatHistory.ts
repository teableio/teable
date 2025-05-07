import { useQuery } from '@tanstack/react-query';
import { getChatHistory } from '@teable/openapi';

export const useChatHistory = (baseId: string) => {
  const { data: chatHistory } = useQuery({
    queryKey: ['chat-history', baseId],
    queryFn: ({ queryKey }) => getChatHistory(queryKey[1]).then((res) => res.data),
  });

  return chatHistory?.history;
};
