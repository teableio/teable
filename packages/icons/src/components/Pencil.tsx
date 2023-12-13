import * as React from 'react';
import type { SVGProps } from 'react';
const Pencil = (props: SVGProps<SVGSVGElement>) => (
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
      d="m18 2 4 4M7.5 20.5 19 9l-4-4L3.5 16.5 2 22z"
    />
  </svg>
);
export default Pencil;
