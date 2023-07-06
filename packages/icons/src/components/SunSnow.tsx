import * as React from 'react';
import type { SVGProps } from 'react';
const SunSnow = (props: SVGProps<SVGSVGElement>) => (
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
      d="M10 9a3 3 0 1 0 0 6M2 12h1M14 21V3M10 4V3M10 21v-1M3.64 18.36l.7-.7M4.34 6.34l-.7-.7M14 12h8M17 4l-3 3M14 17l3 3M21 15l-3-3 3-3"
    />
  </svg>
);
export default SunSnow;
