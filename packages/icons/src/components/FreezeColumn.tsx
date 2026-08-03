import * as React from 'react';
import type { SVGProps } from 'react';
const FreezeColumn = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      fill="#fff"
      fillOpacity={0.01}
      d="M0 1a1 1 0 0 1 1-1h22a1 1 0 0 1 1 1v22a1 1 0 0 1-1 1H1a1 1 0 0 1-1-1z"
    />
    <path
      stroke="currentColor"
      strokeLinejoin="round"
      strokeWidth={1.8}
      d="M21 4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1z"
    />
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth={1.8}
      d="M8.062 3 3 7.5M9.5 6 3 12M9.5 10.5l-6.5 6M9.5 15 4 20M9.5 3v18"
    />
  </svg>
);
export default FreezeColumn;
