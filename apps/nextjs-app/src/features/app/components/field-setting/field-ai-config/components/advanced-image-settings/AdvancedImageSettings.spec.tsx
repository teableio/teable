import { ImageQuality } from '@teable/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdvancedImageSettings } from './AdvancedImageSettings';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      if (key === 'table:field.aiConfig.auto') return 'Auto';
      if (key === 'table:field.aiConfig.resolution.1K') return '1K (Standard)';
      if (key === 'table:field.aiConfig.resolution.2K') return '2K (HD)';
      if (key === 'table:field.aiConfig.resolution.4K') return '4K (Ultra HD)';
      if (key === 'table:field.aiConfig.tip.gptImageResolution') return '4K tooltip';
      return key;
    },
  }),
}));

describe('AdvancedImageSettings', () => {
  it('shows only the ratio selector for GPT Image 2 when defaulting to Auto', () => {
    render(
      <AdvancedImageSettings
        open={true}
        onOpenChange={() => undefined}
        imageModelId="gpt-image-2"
        supportsSize={true}
        supportsAutoSize={true}
        supportsQuality={false}
        supportsAspectRatio={false}
        supportsResolution={false}
        supportsCount={false}
        imageSizeValues={[
          '1024x1024',
          '1536x1024',
          '2048x1536',
          '2880x2880',
          '2048x1152',
          '3840x2160',
        ]}
        aspectRatioValues={[]}
        currentSize=""
        currentQuality={ImageQuality.Medium}
        currentCount={1}
        maxCount={1}
        onChange={() => undefined}
      />
    );

    expect(screen.getAllByRole('combobox')).toHaveLength(1);
    expect(screen.getByRole('combobox')).toHaveTextContent('Auto');
    expect(screen.queryByText('table:field.aiConfig.label.resolution')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('4K tooltip')).not.toBeInTheDocument();
  });

  it('shows mapped ratio and resolution for an existing GPT Image 2 size', () => {
    render(
      <AdvancedImageSettings
        open={true}
        onOpenChange={() => undefined}
        imageModelId="gpt-image-2"
        supportsSize={true}
        supportsAutoSize={true}
        supportsQuality={false}
        supportsAspectRatio={false}
        supportsResolution={false}
        supportsCount={false}
        imageSizeValues={[
          '1024x1024',
          '1536x1024',
          '2048x1360',
          '3504x2336',
          '2048x1152',
          '3840x2160',
        ]}
        aspectRatioValues={[]}
        currentSize="1536x1024"
        currentQuality={ImageQuality.Medium}
        currentCount={1}
        maxCount={1}
        onChange={() => undefined}
      />
    );

    expect(screen.getAllByRole('combobox')).toHaveLength(2);
    expect(screen.getByText('3:2')).toBeInTheDocument();
    expect(screen.getByText('1K (Standard)')).toBeInTheDocument();
    expect(screen.getByText('1536x1024')).toBeInTheDocument();
  });

  it('shows the final output size below resolution for non-auto ratios', () => {
    render(
      <AdvancedImageSettings
        open={true}
        onOpenChange={() => undefined}
        imageModelId="gpt-image-2"
        supportsSize={true}
        supportsAutoSize={true}
        supportsQuality={false}
        supportsAspectRatio={false}
        supportsResolution={false}
        supportsCount={false}
        imageSizeValues={['1024x1024', '2048x2048', '2880x2880', '2048x1152', '3840x2160']}
        aspectRatioValues={[]}
        currentSize="2880x2880"
        currentQuality={ImageQuality.Medium}
        currentCount={1}
        maxCount={1}
        onChange={() => undefined}
      />
    );

    expect(screen.getByText('2880x2880')).toBeInTheDocument();
  });

  it('shows available resolution tiers for the selected ratio', async () => {
    const user = userEvent.setup();

    render(
      <AdvancedImageSettings
        open={true}
        onOpenChange={() => undefined}
        imageModelId="gpt-image-2"
        supportsSize={true}
        supportsAutoSize={true}
        supportsQuality={false}
        supportsAspectRatio={false}
        supportsResolution={false}
        supportsCount={false}
        imageSizeValues={['1024x1024', '1536x1024', '2048x1152', '3840x2160']}
        aspectRatioValues={[]}
        currentSize="3840x2160"
        currentQuality={ImageQuality.Medium}
        currentCount={1}
        maxCount={1}
        onChange={() => undefined}
      />
    );

    await user.click(screen.getAllByRole('combobox')[1]);

    expect(screen.queryByText('1K (Standard)')).not.toBeInTheDocument();
    expect(screen.getAllByText('2K (HD)').length).toBeGreaterThan(0);
    expect(screen.getAllByText('4K (Ultra HD)').length).toBeGreaterThan(0);
  });

  it('shows 4K for a 3:2 ratio when a 4K preset exists', async () => {
    const user = userEvent.setup();

    render(
      <AdvancedImageSettings
        open={true}
        onOpenChange={() => undefined}
        imageModelId="gpt-image-2"
        supportsSize={true}
        supportsAutoSize={true}
        supportsQuality={false}
        supportsAspectRatio={false}
        supportsResolution={false}
        supportsCount={false}
        imageSizeValues={[
          '1024x1024',
          '1536x1024',
          '2048x1360',
          '3504x2336',
          '2048x1152',
          '3840x2160',
        ]}
        aspectRatioValues={[]}
        currentSize="3504x2336"
        currentQuality={ImageQuality.Medium}
        currentCount={1}
        maxCount={1}
        onChange={() => undefined}
      />
    );

    await user.click(screen.getAllByRole('combobox')[1]);

    expect(screen.getAllByText('1K (Standard)').length).toBeGreaterThan(0);
    expect(screen.getAllByText('2K (HD)').length).toBeGreaterThan(0);
    expect(screen.getAllByText('4K (Ultra HD)').length).toBeGreaterThan(0);
  });

  it('hides the resolution selector when no ratio is selected', () => {
    render(
      <AdvancedImageSettings
        open={true}
        onOpenChange={() => undefined}
        imageModelId="gpt-image-2"
        supportsSize={true}
        supportsAutoSize={true}
        supportsQuality={false}
        supportsAspectRatio={false}
        supportsResolution={false}
        supportsCount={false}
        imageSizeValues={[
          '1024x1024',
          '1024x576',
          '576x1024',
          '2880x2880',
          '2048x1152',
          '3840x2160',
        ]}
        aspectRatioValues={[]}
        currentSize=""
        currentQuality={ImageQuality.Medium}
        currentCount={1}
        maxCount={1}
        onChange={() => undefined}
      />
    );

    expect(screen.queryByText('table:field.aiConfig.label.resolution')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('4K tooltip')).not.toBeInTheDocument();
    expect(screen.queryByText('1024x1024')).not.toBeInTheDocument();
  });

  it('allows selecting Auto in the ratio selector', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <AdvancedImageSettings
        open={true}
        onOpenChange={() => undefined}
        imageModelId="gpt-image-2"
        supportsSize={true}
        supportsAutoSize={true}
        supportsQuality={false}
        supportsAspectRatio={false}
        supportsResolution={false}
        supportsCount={false}
        imageSizeValues={[
          '1024x1024',
          '1536x1024',
          '1024x576',
          '3504x2336',
          '2048x1152',
          '3840x2160',
        ]}
        aspectRatioValues={[]}
        currentSize="1536x1024"
        currentQuality={ImageQuality.Medium}
        currentCount={1}
        maxCount={1}
        onChange={onChange}
      />
    );

    await user.click(screen.getAllByRole('combobox')[0]);
    await user.click(screen.getAllByText('Auto')[0]);

    expect(onChange).toHaveBeenCalledWith({ size: undefined });
  });

  it('preserves the current resolution tier when switching to another ratio', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <AdvancedImageSettings
        open={true}
        onOpenChange={() => undefined}
        imageModelId="gpt-image-2"
        supportsSize={true}
        supportsAutoSize={true}
        supportsQuality={false}
        supportsAspectRatio={false}
        supportsResolution={false}
        supportsCount={false}
        imageSizeValues={[
          '1024x1024',
          '1536x1024',
          '2048x1360',
          '3504x2336',
          '2048x1152',
          '3840x2160',
        ]}
        aspectRatioValues={[]}
        currentSize="3840x2160"
        currentQuality={ImageQuality.Medium}
        currentCount={1}
        maxCount={1}
        onChange={onChange}
      />
    );

    await user.click(screen.getAllByRole('combobox')[0]);
    await user.click(screen.getAllByText('3:2')[0]);

    expect(onChange).toHaveBeenCalledWith({ size: '3504x2336' });
  });

  it('preserves a legacy explicit size as ratio plus resolution selectors', () => {
    render(
      <AdvancedImageSettings
        open={true}
        onOpenChange={() => undefined}
        imageModelId="gpt-image-2"
        supportsSize={true}
        supportsAutoSize={true}
        supportsQuality={false}
        supportsAspectRatio={false}
        supportsResolution={false}
        supportsCount={false}
        imageSizeValues={['1024x1024', '1536x1024', '2048x1152', '3840x2160']}
        aspectRatioValues={[]}
        currentSize="3840x2160"
        currentQuality={ImageQuality.Medium}
        currentCount={1}
        maxCount={1}
        onChange={() => undefined}
      />
    );

    expect(screen.getAllByRole('combobox')).toHaveLength(2);
    expect(screen.getByText('16:9')).toBeInTheDocument();
    expect(screen.getByText('4K (Ultra HD)')).toBeInTheDocument();
  });

  it('keeps non-GPT image size Auto selection mapped to undefined', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <AdvancedImageSettings
        open={true}
        onOpenChange={() => undefined}
        imageModelId="dall-e-3"
        supportsSize={true}
        supportsAutoSize={true}
        supportsQuality={false}
        supportsAspectRatio={false}
        supportsResolution={false}
        supportsCount={false}
        imageSizeValues={['1024x1024', '1792x1024', '1024x1792']}
        aspectRatioValues={[]}
        currentSize="1024x1024"
        currentQuality={ImageQuality.Medium}
        currentCount={1}
        maxCount={1}
        onChange={onChange}
      />
    );

    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getAllByText('Auto')[0]);

    expect(onChange).toHaveBeenCalledWith({ size: undefined });
  });

  it('keeps non-GPT aspect ratio and resolution Auto selections mapped to undefined', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <AdvancedImageSettings
        open={true}
        onOpenChange={() => undefined}
        imageModelId="google/gemini-3-pro-image"
        supportsSize={false}
        supportsAutoSize={false}
        supportsQuality={false}
        supportsAspectRatio={true}
        supportsResolution={true}
        supportsCount={false}
        imageSizeValues={[]}
        aspectRatioValues={['1:1', '16:9', '9:16']}
        currentSize=""
        currentQuality={ImageQuality.Medium}
        currentAspectRatio="16:9"
        currentResolution="2K"
        currentCount={1}
        maxCount={1}
        onChange={onChange}
      />
    );

    const comboboxes = screen.getAllByRole('combobox');

    await user.click(comboboxes[0]);
    await user.click(screen.getAllByText('Auto')[0]);
    expect(onChange).toHaveBeenCalledWith({ aspectRatio: undefined });

    await user.click(comboboxes[1]);
    await user.click(screen.getAllByText('Auto')[0]);
    expect(onChange).toHaveBeenCalledWith({ resolution: undefined });
  });
});
