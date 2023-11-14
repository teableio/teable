import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '@teable-group/sdk/context';
import { AuthPage } from '@/features/app/blocks/share/view/AuthPage';

const queryClient = createQueryClient();

export default function ShareAuth() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthPage />
    </QueryClientProvider>
  );
}
