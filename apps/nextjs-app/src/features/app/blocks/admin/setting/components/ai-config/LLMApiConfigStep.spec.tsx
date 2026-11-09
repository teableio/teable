import type { ISettingVo } from '@teable/openapi';
import { MASKED_SECRET_PREFIX } from '@teable/openapi';
import { render, screen, userEvent } from '@/test-utils';
import { LLMApiConfigStep } from './LLMApiConfigStep';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/features/app/hooks/useEnv', () => ({
  useEnv: () => ({ publicOrigin: 'https://example.test' }),
}));

vi.mock('./AIProviderCard', () => ({ AIProviderCard: () => null }));
vi.mock('./BatchTestModels', () => ({ BatchTestModels: () => null }));

const baseProps = {
  mode: 'custom' as const,
  onModeChange: vi.fn(),
  llmProviders: [],
  onProvidersChange: vi.fn(),
  control: {} as never,
  modelTestResults: new Map(),
  onModelTestResultsChange: vi.fn(),
  testingProviders: new Set<string>(),
  onTestingProvidersChange: vi.fn(),
  testingModels: new Set<string>(),
  onTestingModelsChange: vi.fn(),
  onSaveTestResult: vi.fn(),
  onToggleImageModel: vi.fn(),
  testProviderCallbackRef: { current: null },
  testModelCallbackRef: { current: null },
};

describe('LLMApiConfigStep', () => {
  it('allows a dirty empty custom-provider list to be saved', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onComplete = vi.fn();
    render(
      <LLMApiConfigStep
        {...baseProps}
        isDirty
        hasClearedProviders
        onSave={onSave}
        onComplete={onComplete}
      />
    );

    const saveButton = screen.getByRole('button', {
      name: 'admin.setting.ai.wizard.saveAndContinue',
    });
    expect(saveButton).toBeEnabled();

    await userEvent.click(saveButton);

    expect(onSave).toHaveBeenCalledOnce();
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it('keeps an unchanged empty custom-provider list disabled', () => {
    render(<LLMApiConfigStep {...baseProps} isDirty={false} />);

    expect(screen.getByRole('button', { name: 'actions.continue' })).toBeDisabled();
  });

  it('does not treat unrelated LLM API changes as a cleared provider list', () => {
    render(<LLMApiConfigStep {...baseProps} isDirty />);

    expect(
      screen.getByRole('button', { name: 'admin.setting.ai.wizard.saveAndContinue' })
    ).toBeDisabled();
  });

  describe('gateway URL change', () => {
    const savedUrl = 'https://gateway.example.com/v1';
    const savedConfig: NonNullable<ISettingVo['aiConfig']> = {
      llmProviders: [],
      aiGatewayApiKey: `${MASKED_SECRET_PREFIX}gateway`,
      aiGatewayBaseUrl: savedUrl,
    };
    const keyHint = 'admin.setting.secretEndpointChanged';
    const boundKeysWarning = 'admin.setting.ai.wizard.gatewayUrlKeysReenter';

    const renderGateway = (saved: NonNullable<ISettingVo['aiConfig']>) => {
      render(
        <LLMApiConfigStep {...baseProps} mode="gateway" aiConfig={saved} savedAiConfig={saved} />
      );
      return {
        key: screen.getByLabelText(/admin\.setting\.app\.aiGatewayApiKey/),
        url: screen.getByLabelText(/admin\.setting\.app\.aiGatewayBaseUrl/),
      };
    };

    it('clears the masked gateway key once the URL moves, and brings it back with the saved URL', async () => {
      const { key, url } = renderGateway(savedConfig);
      expect(key).toHaveValue(savedConfig.aiGatewayApiKey);

      await userEvent.type(url, '/extra');
      expect(key).toHaveValue('');
      expect(screen.getByText(keyHint)).toBeInTheDocument();

      await userEvent.clear(url);
      await userEvent.type(url, savedUrl);
      expect(key).toHaveValue(savedConfig.aiGatewayApiKey);
      expect(screen.queryByText(keyHint)).not.toBeInTheDocument();
    });

    it('keeps the masked gateway key when the URL is cleared to the default gateway', async () => {
      const { key, url } = renderGateway(savedConfig);

      await userEvent.clear(url);

      expect(key).toHaveValue(savedConfig.aiGatewayApiKey);
      expect(screen.queryByText(keyHint)).not.toBeInTheDocument();
    });

    it('warns that saved Token Group keys must be re-entered when the URL moves', async () => {
      const { url } = renderGateway({
        ...savedConfig,
        concurrencyGroups: [
          {
            id: 'group-1',
            name: 'Group 1',
            taskTypes: [],
            keys: [{ apiKey: `${MASKED_SECRET_PREFIX}pool`, status: 'verified' }],
          },
        ],
      });
      expect(screen.queryByText(boundKeysWarning)).not.toBeInTheDocument();

      await userEvent.type(url, '/extra');
      expect(screen.getByText(boundKeysWarning)).toBeInTheDocument();

      await userEvent.clear(url);
      expect(screen.queryByText(boundKeysWarning)).not.toBeInTheDocument();
    });

    it('does not warn about other keys when the saved config has none', async () => {
      const { url } = renderGateway(savedConfig);

      await userEvent.type(url, '/extra');

      expect(screen.queryByText(boundKeysWarning)).not.toBeInTheDocument();
    });
  });
});
