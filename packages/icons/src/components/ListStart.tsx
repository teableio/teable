import * as React from 'react';
import type { SVGProps } from 'react';
const ListStart = (props: SVGProps<SVGSVGElement>) => (
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
      d="M16 12H3M16 18H3M10 6H3M21 18V8a2 2 0 0 0-2-2h-5"
    />
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="m16 8-2-2 2-2"
    />
  </svg>
);
export default ListStart;
