import * as React from 'react';
import type { SVGProps } from 'react';
const Hammer = (props: SVGProps<SVGSVGElement>) => (
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
      d="m15 12-8.5 8.5a2.118 2.118 0 0 1-3.46-.688A2.12 2.12 0 0 1 3.5 17.5L12 9M17.64 15 22 10.64"
    />
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="m20.91 11.7-1.25-1.25c-.6-.6-.93-1.4-.93-2.25v-.86L16.01 4.6a5.56 5.56 0 0 0-3.94-1.64H9l.92.82A6.179 6.179 0 0 1 12 8.4v1.56l2 2h2.47l2.26 1.91"
    />
  </svg>
);
export default Hammer;
