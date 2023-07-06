import * as React from 'react';
import type { SVGProps } from 'react';
const ServerOff = (props: SVGProps<SVGSVGElement>) => (
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
      d="M7 2h13a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-5M10 10 2.5 2.5C2 2 2 2.5 2 5v3a2 2 0 0 0 2 2h6ZM22 17v-1a2 2 0 0 0-2-2h-1M4 14a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h16.5l1-.5.5.5-8-8H4ZM6 18h.01M2 2l20 20"
    />
  </svg>
);
export default ServerOff;
