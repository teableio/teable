import { cn } from '@udecode/cn';
import { ParagraphPlugin } from '@udecode/plate-common/react';
import {
  type PlaceholderProps,
  createNodeHOC,
  createNodesHOC,
  usePlaceholderState,
} from '@udecode/plate-common/react';
import { HEADING_KEYS } from '@udecode/plate-heading';
import React from 'react';

export const Placeholder = (props: PlaceholderProps) => {
  const { children, nodeProps, placeholder } = props;

  const { enabled } = usePlaceholderState(props);

  return React.Children.map(children, (child) => {
    return React.cloneElement(child, {
      className: child.props.className,
      nodeProps: {
        ...nodeProps,
        className: cn(
          enabled &&
            'before:absolute before:cursor-text before:opacity-30 before:content-[attr(placeholder)]'
        ),
        placeholder,
      },
    });
  });
};

export const withPlaceholder = createNodeHOC(Placeholder);

export const withPlaceholdersPrimitive = createNodesHOC(Placeholder);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const withPlaceholders = (components: any) =>
  withPlaceholdersPrimitive(components, [
    {
      hideOnBlur: true,
      key: ParagraphPlugin.key,
      placeholder: 'Type a paragraph',
      query: {
        maxLevel: 1,
      },
    },
    {
      hideOnBlur: false,
      key: HEADING_KEYS.h1,
      placeholder: 'Untitled',
    },
  ]);
