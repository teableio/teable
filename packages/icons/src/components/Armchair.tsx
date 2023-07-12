import * as React from 'react';
import type { SVGProps } from 'react';
const Armchair = (props: SVGProps<SVGSVGElement>) => (
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
      d="M19 9V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v3"
    />
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M3 11v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5a2 2 0 1 0-4 0v2H7v-2a2 2 0 0 0-4 0ZM5 18v2M19 18v2"
    />
  </svg>
);
export default Armchair;
