import * as React from 'react';
import type { SVGProps } from 'react';
const Component = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.33}
      d="M5.5 8.5 9 12l-3.5 3.5L2 12zM12 2l3.5 3.5L12 9 8.5 5.5zM18.5 8.5 22 12l-3.5 3.5L15 12zM12 15l3.5 3.5L12 22l-3.5-3.5z"
    />
  </svg>
);
export default Component;
