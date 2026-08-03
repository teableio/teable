import * as React from 'react';
import type { SVGProps } from 'react';
const Boolean = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <g clipPath="url(#prefix_boolean)">
      <path
        fill="currentColor"
        d="M16 4a8 8 0 0 1 0 16H8A8 8 0 0 1 8 4zm0 2H8a6 6 0 0 0-.225 11.996L8 18h8a6 6 0 0 0 .225-11.996zm0 1a5 5 0 1 1 0 10 5 5 0 0 1 0-10"
      />
    </g>
    <defs>
      <clipPath id="prefix_boolean">
        <path fill="#fff" d="M0 0h24v24H0z" />
      </clipPath>
    </defs>
  </svg>
);
export default Boolean;
