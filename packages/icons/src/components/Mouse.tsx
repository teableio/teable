import * as React from 'react';
import type { SVGProps } from 'react';
const Mouse = (props: SVGProps<SVGSVGElement>) => (
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
      strokeWidth={2}
      d="M18 9A6 6 0 0 0 6 9v6a6 6 0 0 0 12 0V9ZM12 7v4"
    />
  </svg>
);
export default Mouse;
