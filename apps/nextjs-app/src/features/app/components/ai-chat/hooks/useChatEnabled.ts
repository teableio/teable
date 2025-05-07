import { useBaseUsage } from '@/features/app/hooks/useBaseUsage';

export const useChatEnabled = () => {
  const usage = useBaseUsage();
  const { chatAIEnable = false } = usage?.limit ?? {};
  return chatAIEnable;
};
