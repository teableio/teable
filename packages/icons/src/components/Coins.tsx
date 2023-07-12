import * as React from 'react';
import type { SVGProps } from 'react';
const Coins = (props: SVGProps<SVGSVGElement>) => (
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
      d="M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12ZM18.09 10.37A5.999 5.999 0 1 1 10.34 18"
    />
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M7 6h1v4M16.71 13.88l.7.71-2.82 2.82"
    />
  </svg>
);
export default Coins;
