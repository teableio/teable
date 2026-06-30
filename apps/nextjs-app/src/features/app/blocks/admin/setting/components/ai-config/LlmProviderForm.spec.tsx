import type { LLMProvider } from '@teable/openapi';
import { LLMProviderType } from '@teable/openapi';
import { render, screen, userEvent } from '@/test-utils';
import { LLMProviderForm } from './LlmProviderForm';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/features/app/hooks/useIsCloud', () => ({
  useIsCloud: () => false,
}));

describe('LLMProviderForm', () => {
  it('does not allow a new provider to save display-only edits without a connection test', async () => {
    render(<LLMProviderForm onAdd={vi.fn()} onTest={vi.fn()} />);

    await userEvent.type(screen.getByPlaceholderText('OpenAI / Company Gateway ...'), 'Demo');

    expect(
      screen.getByRole('button', { name: 'admin.setting.ai.testConnection' })
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'actions.add' })).not.toBeInTheDocument();
  });

  it('allows an existing provider to save display-only edits without retesting connectivity', async () => {
    const provider: LLMProvider = {
      type: LLMProviderType.OPENAI,
      name: 'teable',
      displayName: 'OpenAI',
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      models: 'gpt-4o',
      modelConfigs: {},
    };

    render(<LLMProviderForm value={provider} onChange={vi.fn()} onTest={vi.fn()} />);

    const displayNameInput = screen.getByPlaceholderText('OpenAI / Company Gateway ...');
    await userEvent.clear(displayNameInput);
    await userEvent.type(displayNameInput, 'OpenAI Production');

    expect(
      screen.getByRole('button', { name: 'admin.setting.ai.testConnection' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'actions.update' })).toBeInTheDocument();
  });
});
