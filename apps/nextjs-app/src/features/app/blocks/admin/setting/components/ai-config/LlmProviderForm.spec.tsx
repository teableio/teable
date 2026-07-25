import type { IGatewayApiModel, LLMProvider } from '@teable/openapi';
import { getAiProxyGatewayModels, LLMProviderType } from '@teable/openapi';
import { render, screen, userEvent, waitFor, within } from '@/test-utils';
import { LLM_PROVIDERS } from './constant';
import { LLMProviderForm } from './LlmProviderForm';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@teable/openapi', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getAiProxyGatewayModels: vi.fn() };
});

const editionMock = vi.hoisted(() => ({ isEE: true }));
vi.mock('@/features/app/hooks/useIsEE', () => ({ useIsEE: () => editionMock.isEE }));

const mockGatewayModels = (models: IGatewayApiModel[]) => {
  vi.mocked(getAiProxyGatewayModels).mockResolvedValue({
    data: { configured: true, models },
  } as Awaited<ReturnType<typeof getAiProxyGatewayModels>>);
};

const setProviderHidden = (type: LLMProviderType, hidden: boolean) => {
  const provider = LLM_PROVIDERS.find((p) => p.value === type);
  if (!provider) return;
  if (hidden) {
    (provider as { hideInProviderSelect?: boolean }).hideInProviderSelect = true;
  } else {
    delete (provider as { hideInProviderSelect?: boolean }).hideInProviderSelect;
  }
};

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.scrollIntoView ??= () => undefined;
});

afterEach(() => {
  setProviderHidden(LLMProviderType.OPENROUTER, false);
  editionMock.isEE = true;
});

beforeEach(() => {
  mockGatewayModels([]);
});

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

  it('hides marked providers from new selections but keeps historical selections visible', async () => {
    setProviderHidden(LLMProviderType.OPENROUTER, true);

    render(<LLMProviderForm onAdd={vi.fn()} onTest={vi.fn()} />);
    await userEvent.click(screen.getByRole('combobox'));

    expect(screen.queryByRole('option', { name: /OpenRouter/ })).not.toBeInTheDocument();
  });

  it('keeps a historical hidden provider visible as disabled', async () => {
    setProviderHidden(LLMProviderType.OPENROUTER, true);
    const provider: LLMProvider = {
      type: LLMProviderType.OPENROUTER,
      name: 'teable',
      displayName: 'OpenRouter',
      apiKey: 'sk-test',
      baseUrl: 'https://openrouter.ai/api/v1',
      models: 'anthropic/claude-sonnet-4-6',
      modelConfigs: {},
    };

    render(<LLMProviderForm value={provider} onChange={vi.fn()} onTest={vi.fn()} />);
    await userEvent.click(screen.getByRole('combobox'));

    expect(screen.getByRole('option', { name: /OpenRouter/ })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
  });

  it("rejects a model id containing '@' in the model list editor", async () => {
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

    const input = screen.getByPlaceholderText('gpt-5.5,o3,gpt-5-mini');
    await userEvent.type(input, 'model@version{Enter}');

    expect(screen.queryByText('model@version')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'admin.setting.ai.addModelFill' })).toBeDisabled();
    expect(screen.getByText('admin.setting.ai.modelIdReservedAt')).toBeInTheDocument();
  });

  describe('per-model settings editor', () => {
    const provider: LLMProvider = {
      type: LLMProviderType.OPENAI,
      name: 'teable',
      displayName: 'OpenAI',
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      models: 'gpt-4o',
      modelConfigs: {},
    };

    const expandModelSettings = async () => {
      await userEvent.click(
        screen.getByRole('button', { name: /admin\.setting\.ai\.modelSettings/ })
      );
    };

    const openModelEditor = async () => {
      await userEvent.click(screen.getByRole('button', { name: 'actions.edit' }));
    };

    const closeModelEditor = async () => {
      await userEvent.keyboard('{Escape}');
    };

    it('does not request gateway models on the community edition', async () => {
      editionMock.isEE = false;
      vi.mocked(getAiProxyGatewayModels).mockClear();
      render(<LLMProviderForm value={provider} onChange={vi.fn()} onTest={vi.fn()} />);

      await expandModelSettings();

      expect(vi.mocked(getAiProxyGatewayModels)).not.toHaveBeenCalled();
    });

    it('shows pricing on every edition and submits an edited context window cap', async () => {
      const onChange = vi.fn();
      render(<LLMProviderForm value={provider} onChange={onChange} onTest={vi.fn()} />);

      await expandModelSettings();
      // The context-window cap renders from saved config, not the gateway fetch.
      await openModelEditor();
      await userEvent.type(screen.getByPlaceholderText('128000'), '200000');
      await closeModelEditor();
      await userEvent.click(screen.getByRole('button', { name: 'actions.update' }));

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          modelConfigs: expect.objectContaining({
            'gpt-4o': expect.objectContaining({ contextWindow: 200000 }),
          }),
        })
      );
    });

    it('enables update after editing only a cap, without a connectivity retest', async () => {
      render(<LLMProviderForm value={provider} onChange={vi.fn()} onTest={vi.fn()} />);

      await expandModelSettings();
      expect(screen.queryByRole('button', { name: 'actions.update' })).not.toBeInTheDocument();

      await openModelEditor();
      await userEvent.type(screen.getByPlaceholderText('8192'), '4096');
      await closeModelEditor();

      expect(
        screen.getByRole('button', { name: 'admin.setting.ai.testConnection' })
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'actions.update' })).toBeInTheDocument();
    });

    it('hides pricing but keeps caps editable in space settings', async () => {
      const onChange = vi.fn();
      render(
        <LLMProviderForm value={provider} onChange={onChange} onTest={vi.fn()} hideModelRates />
      );

      await userEvent.click(
        screen.getByRole('button', { name: /admin\.setting\.ai\.modelSettings/ })
      );

      await openModelEditor();
      const editorDialog = await screen.findByRole('dialog');
      expect(within(editorDialog).getByRole('combobox')).toBeInTheDocument();
      expect(screen.queryByText('admin.setting.ai.gatewayRatio')).not.toBeInTheDocument();
      await userEvent.type(screen.getByPlaceholderText('8192'), '4096');
      await closeModelEditor();
      await userEvent.click(screen.getByRole('button', { name: 'actions.update' }));

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          modelConfigs: expect.objectContaining({
            'gpt-4o': expect.objectContaining({ maxTokens: 4096 }),
          }),
        })
      );
    });

    it('keeps the reference picker and caps editable for an auto-matched model', async () => {
      mockGatewayModels([
        {
          id: 'openai/gpt-4o',
          pricing: { input: '0.0000025', output: '0.00001' },
          contextWindow: 128000,
          maxTokens: 16384,
          tags: ['reasoning', 'vision'],
        },
      ]);
      // provider model is 'gpt-4o', which auto-matches 'openai/gpt-4o' by id.
      render(<LLMProviderForm value={provider} onChange={vi.fn()} onTest={vi.fn()} />);

      await expandModelSettings();
      await openModelEditor();

      const editorDialog = await screen.findByRole('dialog');
      const pickerTrigger = within(editorDialog).getByRole('combobox');
      // The auto-match is only a default: the reference and caps stay editable
      // so admins can override them.
      await waitFor(() => expect(pickerTrigger).toHaveTextContent('openai/gpt-4o'));
      expect(pickerTrigger).toBeEnabled();
      expect(screen.getByPlaceholderText('128000')).toBeEnabled();
      expect(screen.getByPlaceholderText('16384')).toBeEnabled();
    });

    it('lets a non-auto-matched model pick a reference and inherit its pricing, caps and tags', async () => {
      mockGatewayModels([
        {
          id: 'openai/gpt-4o',
          pricing: { input: '0.0000025', output: '0.00001' },
          contextWindow: 128000,
          maxTokens: 16384,
          tags: ['reasoning', 'vision'],
        },
      ]);
      // A custom model id with no gateway equivalent: the picker is editable.
      const customProvider: LLMProvider = { ...provider, models: 'my-custom-model' };
      const onChange = vi.fn();
      render(<LLMProviderForm value={customProvider} onChange={onChange} onTest={vi.fn()} />);

      // The unmatched model auto-expands the settings section; wait for it
      // instead of clicking the toggle (which would collapse it again).
      await screen.findByText('admin.setting.ai.rateExplanationTitle');
      await openModelEditor();

      const editorDialog = await screen.findByRole('dialog');
      const pickerTrigger = within(editorDialog).getByRole('combobox');
      await waitFor(() => expect(pickerTrigger).toBeEnabled());
      await userEvent.click(pickerTrigger);
      await userEvent.click(await screen.findByRole('option', { name: /openai\/gpt-4o/ }));

      // Picking the reference copies its caps into the editable inputs
      expect(screen.getByDisplayValue('128000')).toBeInTheDocument();
      expect(screen.getByDisplayValue('16384')).toBeInTheDocument();

      await closeModelEditor();
      await userEvent.click(screen.getByRole('button', { name: 'actions.update' }));

      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          modelConfigs: expect.objectContaining({
            'my-custom-model': expect.objectContaining({
              referenceModel: 'openai/gpt-4o',
              // The ratio input was empty, so pricing is copied at ×1.
              pricing: { input: '0.0000025', output: '0.00001' },
              contextWindow: 128000,
              maxTokens: 16384,
              tags: ['reasoning', 'vision'],
            }),
          }),
        })
      );
    });

    it('auto-expands model settings when a model has no auto-matched reference', async () => {
      mockGatewayModels([
        {
          id: 'openai/gpt-4o',
          pricing: { input: '0.0000025', output: '0.00001' },
          contextWindow: 128000,
          maxTokens: 16384,
        },
      ]);
      // 'my-custom-model' has no gateway match and no saved config.
      const customProvider: LLMProvider = { ...provider, models: 'gpt-4o,my-custom-model' };
      render(<LLMProviderForm value={customProvider} onChange={vi.fn()} onTest={vi.fn()} />);

      expect(await screen.findByText('admin.setting.ai.rateExplanationTitle')).toBeInTheDocument();
    });

    it('auto-expands model settings when a newly typed model has no reference match', async () => {
      mockGatewayModels([
        {
          id: 'openai/gpt-4o',
          pricing: { input: '0.0000025', output: '0.00001' },
          contextWindow: 128000,
          maxTokens: 16384,
        },
      ]);
      render(<LLMProviderForm value={provider} onChange={vi.fn()} onTest={vi.fn()} />);

      // Wait for the gateway load + pricing materialization (which marks the form
      // dirty and reveals Update); the matched model must not auto-expand.
      await screen.findByRole('button', { name: 'actions.update' });
      expect(screen.queryByText('admin.setting.ai.rateExplanationTitle')).not.toBeInTheDocument();

      const input = screen.getByPlaceholderText('gpt-5.5,o3,gpt-5-mini');
      await userEvent.type(input, 'my-custom-model{Enter}');

      expect(await screen.findByText('admin.setting.ai.rateExplanationTitle')).toBeInTheDocument();
    });

    it('materializes missing pricing from the auto-matched reference without opening model settings', async () => {
      mockGatewayModels([
        {
          id: 'openai/gpt-4o',
          pricing: { input: '0.0000025', output: '0.00001' },
          contextWindow: 128000,
          maxTokens: 16384,
        },
      ]);
      const onChange = vi.fn();
      // provider model 'gpt-4o' auto-matches 'openai/gpt-4o' but has no pricing saved.
      render(<LLMProviderForm value={provider} onChange={onChange} onTest={vi.fn()} />);

      // The pricing write marks the form dirty, so Update appears with no user edits.
      await userEvent.click(await screen.findByRole('button', { name: 'actions.update' }));

      const submitted = onChange.mock.calls[0][0] as LLMProvider;
      expect(submitted.modelConfigs?.['gpt-4o']?.pricing).toEqual({
        input: '0.0000025',
        output: '0.00001',
      });
      // Caps are persisted too, so backend model-caps resolution (which only reads
      // modelConfigs[model]) sees the limits the editor displays.
      expect(submitted.modelConfigs?.['gpt-4o']?.contextWindow).toBe(128000);
      expect(submitted.modelConfigs?.['gpt-4o']?.maxTokens).toBe(16384);
      // The auto-match stays dynamic: the reference id itself is not persisted.
      expect(submitted.modelConfigs?.['gpt-4o']?.referenceModel).toBeUndefined();
    });

    it('materializes pricing in space settings too, where it is inert for BYOK', async () => {
      mockGatewayModels([
        {
          id: 'openai/gpt-4o',
          pricing: { input: '0.0000025', output: '0.00001' },
          contextWindow: 128000,
          maxTokens: 16384,
        },
      ]);
      const onChange = vi.fn();
      render(
        <LLMProviderForm value={provider} onChange={onChange} onTest={vi.fn()} hideModelRates />
      );

      await userEvent.click(await screen.findByRole('button', { name: 'actions.update' }));

      const submitted = onChange.mock.calls[0][0] as LLMProvider;
      expect(submitted.modelConfigs?.['gpt-4o']?.pricing).toEqual({
        input: '0.0000025',
        output: '0.00001',
      });
    });

    it('ignores a zero ratio instead of zeroing out the derived pricing', async () => {
      mockGatewayModels([
        {
          id: 'openai/gpt-4o',
          pricing: { input: '0.0000025', output: '0.00001' },
          contextWindow: 128000,
          maxTokens: 16384,
        },
      ]);
      const onChange = vi.fn();
      render(<LLMProviderForm value={provider} onChange={onChange} onTest={vi.fn()} />);

      await expandModelSettings();
      await openModelEditor();
      const ratioInput = await screen.findByPlaceholderText('1');
      await userEvent.clear(ratioInput);
      await userEvent.type(ratioInput, '0');
      await closeModelEditor();
      await userEvent.click(screen.getByRole('button', { name: 'actions.update' }));

      const submitted = onChange.mock.calls[0][0] as LLMProvider;
      expect(submitted.modelConfigs?.['gpt-4o']?.pricing).toEqual({
        input: '0.0000025',
        output: '0.00001',
      });
    });

    it('clears the cap on empty input and ignores zero or garbage values', async () => {
      const onChange = vi.fn();
      render(<LLMProviderForm value={provider} onChange={onChange} onTest={vi.fn()} />);

      await expandModelSettings();
      await openModelEditor();
      const contextInput = screen.getByPlaceholderText('128000');
      await userEvent.type(contextInput, '200000');
      await userEvent.clear(contextInput);
      await userEvent.type(contextInput, '0');
      await closeModelEditor();
      await userEvent.click(screen.getByRole('button', { name: 'actions.update' }));

      const submitted = onChange.mock.calls[0][0] as LLMProvider;
      expect(submitted.modelConfigs?.['gpt-4o']?.contextWindow).toBeUndefined();
    });
  });
});
