import { fireEvent, render, screen } from '@testing-library/react';
import { BaseSingleSelect } from '../BaseSingleSelect';

window.ResizeObserver =
  window.ResizeObserver ||
  jest.fn().mockImplementation(() => ({
    disconnect: jest.fn(),
    observe: jest.fn(),
    unobserve: jest.fn(),
  }));

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
    render(<BaseSingleSelect options={options} onSelect={onSelect} value="value-1" />);
    const button = screen.getByRole('combobox');
    expect(button).toHaveTextContent('label-1');
  });

  it('should render default palceholder: Search...', async () => {
    render(<BaseSingleSelect options={options} onSelect={onSelect} value={null} />);
    toggleOpen();
    const searchPlaceHolder = screen.getByPlaceholderText('Search...');
    expect(searchPlaceHolder).toBeDefined();
  });

  it('should render right length options', async () => {
    render(<BaseSingleSelect options={options} onSelect={onSelect} value={null} />);
    toggleOpen();
    const option = screen.getAllByRole('option');
    expect(option).toHaveLength(2);
  });

  it('should return the selected option value', async () => {
    const selecthandle = jest.fn();
    render(<BaseSingleSelect options={options} onSelect={selecthandle} value={null} />);
    toggleOpen();
    fireEvent.click(screen.getAllByRole('option')[0]);
    expect(selecthandle).toHaveBeenCalledWith('value-1');
  });

  it('should display the selected option value', async () => {
    const { rerender } = render(
      <BaseSingleSelect options={options} onSelect={onSelect} value={null} />
    );
    toggleOpen();
    fireEvent.click(screen.getByText('label-1'));
    rerender(<BaseSingleSelect options={options} onSelect={onSelect} value={'value-1'} />);
    const combobox = screen.getByRole('combobox');
    expect(combobox).toHaveTextContent('label-1');
  });

  it('should render search option', async () => {
    render(<BaseSingleSelect options={options} onSelect={onSelect} value={null} />);
    toggleOpen();
    const input = screen.getByPlaceholderText('Search...');
    fireEvent.change(input, { target: { value: 'label-1' } });
    const option = screen.getAllByRole('option');
    expect(option).toHaveLength(1);
    expect(option[0]).toHaveTextContent('label-1');
  });
});
