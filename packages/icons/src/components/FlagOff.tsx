import * as React from 'react';
import type { SVGProps } from 'react';
const FlagOff = (props: SVGProps<SVGSVGElement>) => (
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
      d="M8 2c3 0 5 2 8 2s4-1 4-1v11M4 22V4M4 15s1-1 4-1 5 2 8 2M2 2l20 20"
    />
  </svg>
);
export default FlagOff;
