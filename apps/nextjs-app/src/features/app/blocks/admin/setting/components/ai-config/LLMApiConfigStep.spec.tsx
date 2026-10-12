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
});
