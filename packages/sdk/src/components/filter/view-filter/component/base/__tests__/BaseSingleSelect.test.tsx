import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { createAppContext } from '../../../../../../context/__tests__/createAppContext';
import { defaultLocale } from '../../../../../../context/app/i18n';
import { BaseSingleSelect } from '../BaseSingleSelect';

const mockResizeObserver = {
  disconnect: vi.fn(),
  observe: vi.fn(),
  unobserve: vi.fn(),
};

globalThis.ResizeObserver = globalThis.ResizeObserver || mockResizeObserver;

describe('BaseSingleSelect', () => {
  const options = [
    {
      label: 'label-1',
      value: 'value-1',
    },
    {
      label: 'label-2',
      value: 'value-2',
    },
  ];
  const toggleOpen = async () => {
    fireEvent.click(screen.getByRole('combobox'));
  };
  const onSelect = () => {};

  it('should render combobox', async () => {
    render(<BaseSingleSelect options={options} onSelect={onSelect} value="value-1" />, {
      wrapper: createAppContext(),
    });
    const button = screen.getByRole('combobox');
    expect(button).toHaveTextContent('label-1');
  });

  it('should render default placeholder: Search...', async () => {
    render(<BaseSingleSelect options={options} onSelect={onSelect} value={null} />, {
      wrapper: createAppContext(),
    });
    toggleOpen();
    const searchPlaceHolder = screen.getByPlaceholderText(defaultLocale.common.search.placeholder);
    expect(searchPlaceHolder).toBeDefined();
  });

  it('should render right length options', async () => {
    render(<BaseSingleSelect options={options} onSelect={onSelect} value={null} />, {
      wrapper: createAppContext(),
    });
    toggleOpen();
    const option = screen.getAllByRole('option');
    expect(option).toHaveLength(2);
  });

  it('should return the selected option value', async () => {
    const selecthandle = vi.fn();
    render(<BaseSingleSelect options={options} onSelect={selecthandle} value={null} />, {
      wrapper: createAppContext(),
    });
    toggleOpen();
    fireEvent.click(screen.getAllByRole('option')[0]);
    expect(selecthandle).toHaveBeenCalledWith('value-1');
  });

  it('should display the selected option value', async () => {
    const { rerender } = render(
      <BaseSingleSelect options={options} onSelect={onSelect} value={null} />,
      {
        wrapper: createAppContext(),
      }
    );
    toggleOpen();
    fireEvent.click(screen.getByText('label-1'));
    rerender(<BaseSingleSelect options={options} onSelect={onSelect} value={'value-1'} />);
    const combobox = screen.getByRole('combobox');
    expect(combobox).toHaveTextContent('label-1');
  });

  it('should render search option', async () => {
    render(<BaseSingleSelect options={options} onSelect={onSelect} value={null} />, {
      wrapper: createAppContext(),
    });
    toggleOpen();

    const input = screen.getByPlaceholderText(defaultLocale.common.search.placeholder);
    fireEvent.change(input, { target: { value: 'label-1' } });
    const option = screen.getAllByRole('option');
    expect(option).toHaveLength(1);
    expect(option[0]).toHaveTextContent('label-1');
  });
});
