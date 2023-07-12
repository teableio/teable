import * as React from 'react';
import type { SVGProps } from 'react';
const LampWallUp = (props: SVGProps<SVGSVGElement>) => (
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
      d="M11 4h6l3 7H8l3-7ZM14 11v5a2 2 0 0 1-2 2H8M4 15h2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H4v-6Z"
    />
  </svg>
);
export default LampWallUp;
