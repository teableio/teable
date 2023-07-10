import * as React from 'react';
import type { SVGProps } from 'react';
const Scroll = (props: SVGProps<SVGSVGElement>) => (
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
      d="M10 17v2a2 2 0 0 1-4 0V5a2 2 0 1 0-4 0v3h3"
    />
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M22 17v2a2 2 0 0 1-2 2H8M19 17V5a2 2 0 0 0-2-2H4M22 17H10"
    />
  </svg>
);
export default Scroll;
