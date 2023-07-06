import * as React from 'react';
import type { SVGProps } from 'react';
const Currency = (props: SVGProps<SVGSVGElement>) => (
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
      d="M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM3 3l3 3M21 3l-3 3M3 21l3-3M21 21l-3-3"
    />
  </svg>
);
export default Currency;
