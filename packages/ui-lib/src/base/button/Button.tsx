// To test out support for emotion-11/css prop in storybook

import type { FC } from 'react';
import React from 'react';
import { cssButtonStyle } from './Button.styles';

type ButtonProps = {
  /**
   * Is this the principal call to action on the page?
   */
  primary?: boolean;
  /**
   * What background color to use
   */
  backgroundColor?: string;
  /**
   * How large should the button be?
   */
  size?: 'small' | 'medium' | 'large';
  /**
   * Button contents
   */
  label: string;
  /**
   * Optional click handler
   */
  onClick?: () => void;
  children?: never;
};

/**
 * Primary UI component for user interaction
 */
export const Button: FC<ButtonProps> = (props) => {
  const {
    primary = false,
    size = 'medium',
    backgroundColor,
    label,
    ...restProps
  } = props;
  const mode = primary ? 'primary' : 'secondary';
  return (
    <button
      css={cssButtonStyle}
      type="button"
      className={[size, mode].join(' ')}
      style={{ backgroundColor }}
      {...restProps}
    >
      {label}
    </button>
  );
};
