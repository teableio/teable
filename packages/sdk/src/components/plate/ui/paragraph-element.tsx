import { withCn } from '@udecode/cn';
import { PlateElement } from '@udecode/plate/react';
import type { ComponentProps, FC } from 'react';

export const ParagraphElement: FC<ComponentProps<typeof PlateElement>> = withCn(
  PlateElement,
  'm-0 px-0 py-0 leading-6'
) as unknown as FC<ComponentProps<typeof PlateElement>>;
