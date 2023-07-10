import * as React from 'react';
import type { SVGProps } from 'react';
const Grab = (props: SVGProps<SVGSVGElement>) => (
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
      d="M18 11.5V9a2 2 0 1 0-4 0v1.4M14 10V8a2 2 0 1 0-4 0v2M10 9.9V9a2 2 0 1 0-4 0v5M6 14a2 2 0 0 0-4 0"
    />
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-4a8 8 0 0 1-8-8 2 2 0 0 1 4 0"
    />
  </svg>
);
export default Grab;
