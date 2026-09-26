import { act, fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { createAppContext } from '../../../../../../context/__tests__/createAppContext';
import { BaseMultipleSelect } from '../BaseMultipleSelect';

const mockResizeObserver = {
  disconnect: vi.fn(),
  observe: vi.fn(),
  unobserve: vi.fn(),
};

globalThis.ResizeObserver = globalThis.ResizeObserver || mockResizeObserver;

describe('BaseMultipleSelect', () => {
  const options = [
    {
      label: 'label-1',
      value: 'value-1',
    },
    {
      label: 'label-2',
      value: 'value-2',
    },
    {
      label: 'label-3',
      value: 'value-3',
    },
    {
      label: 'label-4',
      value: 'value-4',
    },
  ];
  const toggleOpen = async () => {
    fireEvent.click(screen.getByRole('combobox'));
  };
  const initvalue = ['value-1'];
  const onSelect = () => {};

  it('cancels pending search when the filter unmounts or changes its callback', () => {
    vi.useFakeTimers();
    const first = vi.fn();
    const second = vi.fn();
    const view = render(
      <BaseMultipleSelect options={options} value={null} onSelect={onSelect} onSearch={first} />,
      { wrapper: createAppContext() }
    );
    try {
      view.rerender(
        <BaseMultipleSelect options={options} value={null} onSelect={onSelect} onSearch={second} />
      );
      act(() => vi.advanceTimersByTime(200));
      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledWith('');
      second.mockClear();
      view.rerender(
        <BaseMultipleSelect options={options} value={null} onSelect={onSelect} onSearch={first} />
      );
      view.unmount();
      act(() => vi.advanceTimersByTime(200));
      expect(first).not.toHaveBeenCalled();
      expect(second).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('should render init selected value label', async () => {
    render(<BaseMultipleSelect options={options} onSelect={onSelect} value={initvalue} />, {
      wrapper: createAppContext(),
    });
    const triggerButton = screen.getByRole('combobox');
    expect(triggerButton).toHaveTextContent('label-1');
  });

  it('should render dialog even click option', async () => {
    render(<BaseMultipleSelect options={options} onSelect={onSelect} value={initvalue} />, {
      wrapper: createAppContext(),
    });
    toggleOpen();
    const dialog = screen.getByRole('dialog');
    fireEvent.click(screen.getAllByRole('option')[0]);
    expect(dialog).toBeDefined();
  });

  it('should call onSelect twice', async () => {
    const selectHandler = vi.fn();
    render(<BaseMultipleSelect options={options} onSelect={selectHandler} value={null} />, {
      wrapper: createAppContext(),
    });
    toggleOpen();
    fireEvent.click(screen.getAllByRole('option')[0]);
    fireEvent.click(screen.getAllByRole('option')[1]);
    expect(selectHandler).toHaveBeenCalledTimes(2);
  });
});
