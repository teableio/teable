import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ButtonOptions } from '../ButtonOptions';

// Mock the i18n hook
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key, // Simply return the key as translation
  }),
}));

// Mock the workflow store
vi.mock('@/features/app/automation/workflow-panel/useWorkFlowPaneStore', () => ({
  useWorkFlowPanelStore: () => ({
    setModal: vi.fn(),
  }),
}));

// Mock the base usage hook
vi.mock('@/features/app/hooks/useBaseUsage', () => ({
  useBaseUsage: () => ({
    limit: {
      automationEnable: true,
    },
  }),
}));

describe('ButtonOptions', () => {
  const mockOnChange = vi.fn();

  beforeEach(() => {
    mockOnChange.mockClear();
  });

  it('renders workflow action by default', () => {
    render(<ButtonOptions options={{}} onChange={mockOnChange} />);

    expect(screen.getByText('table:field.default.button.action')).toBeInTheDocument();
    expect(screen.getByText('table:field.default.button.triggerWorkflow')).toBeInTheDocument();
  });

  it('switches to openLink action when selected', () => {
    render(<ButtonOptions options={{}} onChange={mockOnChange} />);

    const selectTrigger = screen.getByRole('combobox');
    fireEvent.click(selectTrigger);

    const openLinkOption = screen.getByText('table:field.default.button.openLink');
    fireEvent.click(openLinkOption);

    expect(mockOnChange).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'openLink',
        workflow: undefined,
      })
    );

    expect(screen.getByPlaceholderText('https://example.com')).toBeInTheDocument();
    expect(screen.getByText('table:field.default.button.openInNewTab')).toBeInTheDocument();
  });

  it('renders openLink action when set in options', () => {
    const options = {
      action: 'openLink' as const,
      url: 'https://test.com',
      openInNewTab: false,
    };

    render(<ButtonOptions options={options} onChange={mockOnChange} />);

    expect(screen.getByDisplayValue('https://test.com')).toBeInTheDocument();

    // Check that the switch is off
    const switchElement = screen.getByRole('switch');
    expect(switchElement).not.toBeChecked();
  });

  it('updates URL when changed', () => {
    const options = {
      action: 'openLink' as const,
      url: 'https://test.com',
    };

    render(<ButtonOptions options={options} onChange={mockOnChange} />);

    const urlInput = screen.getByDisplayValue('https://test.com');
    fireEvent.change(urlInput, { target: { value: 'https://new-url.com' } });

    expect(mockOnChange).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://new-url.com',
      })
    );
  });

  it('toggles openInNewTab option', () => {
    const options = {
      action: 'openLink' as const,
      url: 'https://test.com',
      openInNewTab: true,
    };

    render(<ButtonOptions options={options} onChange={mockOnChange} />);

    const switchElement = screen.getByRole('switch');
    expect(switchElement).toBeChecked();

    fireEvent.click(switchElement);

    expect(mockOnChange).toHaveBeenCalledWith(
      expect.objectContaining({
        openInNewTab: false,
      })
    );
  });

  it('switches from openLink back to workflow', () => {
    const options = {
      action: 'openLink' as const,
      url: 'https://test.com',
      openInNewTab: true,
    };

    render(<ButtonOptions options={options} onChange={mockOnChange} />);

    const selectTrigger = screen.getByRole('combobox');
    fireEvent.click(selectTrigger);

    const workflowOption = screen.getByText('table:field.default.button.triggerWorkflow');
    fireEvent.click(workflowOption);

    expect(mockOnChange).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'workflow',
      })
    );

    expect(mockOnChange).toHaveBeenCalledWith(
      expect.not.objectContaining({
        url: expect.any(String),
      })
    );
  });

  it('does not render action selection for lookup fields', () => {
    render(<ButtonOptions options={{}} onChange={mockOnChange} isLookup={true} />);

    expect(screen.queryByText('table:field.default.button.action')).not.toBeInTheDocument();
    expect(
      screen.queryByText('table:field.default.button.triggerWorkflow')
    ).not.toBeInTheDocument();
    expect(screen.queryByText('table:field.default.button.openLink')).not.toBeInTheDocument();
  });

  it('clears workflow when switching to openLink', () => {
    const options = {
      action: 'workflow' as const,
      workflow: {
        id: 'workflow_123',
        name: 'Test Workflow',
        isActive: true,
      },
    };

    render(<ButtonOptions options={options} onChange={mockOnChange} />);

    const selectTrigger = screen.getByRole('combobox');
    fireEvent.click(selectTrigger);

    const openLinkOption = screen.getByText('table:field.default.button.openLink');
    fireEvent.click(openLinkOption);

    expect(mockOnChange).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'openLink',
        workflow: undefined,
      })
    );
  });
});
