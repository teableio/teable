import type { IAIConfigVo } from '@teable/openapi';
import { Form } from '@teable/ui-lib/shadcn';
import { useForm } from 'react-hook-form';
import { render, screen } from '@/test-utils';
import { AIProviderCard } from './AIProviderCard';

vi.mock('./LlmproviderManage', async () => {
  const { forwardRef } = await import('react');
  return {
    LLMProviderManage: forwardRef<HTMLDivElement, { value?: unknown[] }>(({ value }, ref) => (
      <div
        ref={ref}
        data-testid="provider-manager"
        data-provider-count={value?.length ?? 'missing'}
      />
    )),
  };
});

const PartialConfigCard = () => {
  const form = useForm<IAIConfigVo>({
    defaultValues: { capabilities: { disableActions: [] } },
  });

  return (
    <Form {...form}>
      <AIProviderCard control={form.control} />
    </Form>
  );
};

describe('AIProviderCard', () => {
  it('normalizes a missing provider list from a partial AI config', () => {
    render(<PartialConfigCard />);

    expect(screen.getByTestId('provider-manager')).toHaveAttribute('data-provider-count', '0');
  });
});
