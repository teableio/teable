import { css } from '@emotion/react';
import styled from '@emotion/styled';

const gradients = {
  sky: css`
    background: linear-gradient(
      90deg,
      rgba(33, 169, 192, 1) 0%,
      rgba(113, 223, 208, 1) 70%,
      rgba(113, 223, 208, 1) 100%
    );
  `,
  orange: css`
    background: linear-gradient(
      90deg,
      rgb(217, 102, 23) 0%,
      rgb(69, 112, 229) 70%,
      rgb(127, 151, 249) 100%
    );
  `,
  green: css`
    background: linear-gradient(
      90deg,
      rgb(155, 235, 16) 0%,
      rgb(213, 226, 13) 70%,
      rgb(48, 206, 17) 100%
    );
  `,
  violet: css`
    background: linear-gradient(
      90deg,
      rgb(117, 4, 139) 0%,
      rgb(194, 69, 229) 70%,
      rgb(252, 14, 174) 100%
    );
  `,
} as const;

// type GradientTextBackgrounds = Simplify<keyof typeof gradients>;
export type GradientTextBackgrounds = keyof typeof gradients;

type GradientTextProps = {
  /**
   * Background color of the text
   */
  bg?: keyof typeof gradients;
  // css?: SerializedStyles;
};

/*
export const GradientText: FC<GradientTextProps> = (props) => {
  return <span>{props.children}</span>;
};

 */

export const GradientText = styled.span<GradientTextProps>`
  ${(props) => gradients[props?.bg ?? 'sky']};
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  position: absolute;
  left: 0;
  &.fadeIn {
    opacity: 1;
    transition-property: opacity;
    transition-duration: 1.5s;
    transition-timing-function: ease-in;
  }
  &.fadeOut {
    opacity: 0;
    transform: translate(50px);
    transition: all 1.5s ease-out;
    overflow: hidden;
    &:last-of-type {
      font-size: 18em;
      transition-duration: 1s;
    }
  }
  ${(props) => {
    const { css } = props;
    return css;
  }};
`;
