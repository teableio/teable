import * as React from 'react';
import type { SVGProps } from 'react';
const Usb = (props: SVGProps<SVGSVGElement>) => (
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
      d="M4 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM10 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM4 20 19 5M21 3l-3 1 2 2 1-3Z"
    />
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="m10 7-5 5 2 5M10 14l5 2 4-4"
    />
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="m18 12 1-1 1 1-1 1-1-1Z"
    />
  </svg>
);
export default Usb;
