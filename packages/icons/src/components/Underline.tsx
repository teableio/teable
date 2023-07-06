import * as React from 'react';
import type { SVGProps } from 'react';
const Underline = (props: SVGProps<SVGSVGElement>) => (
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
      d="M6 4v6a6 6 0 1 0 12 0V4M4 20h16"
    />
  </svg>
);
export default Underline;
