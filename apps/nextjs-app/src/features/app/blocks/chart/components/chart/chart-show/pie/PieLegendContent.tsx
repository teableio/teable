import { ChartLegendContent } from '@teable/ui-lib';
import React from 'react';

export const PieLegendContent = React.forwardRef<
  React.ElementRef<typeof ChartLegendContent>,
  React.ComponentProps<typeof ChartLegendContent>
>((props, ref) => {
  const { payload, ...rest } = props;
  return (
    <ChartLegendContent
      ref={ref}
      {...rest}
      payload={payload?.map((item) => ({
        ...item,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        pieColorKey: `${(item.payload as any)?.payload?.value}`,
      }))}
    />
  );
});

PieLegendContent.displayName = 'PieLegendContent';
