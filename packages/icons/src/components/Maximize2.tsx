import * as React from 'react';
import type { SVGProps } from 'react';
const Maximize2 = (props: SVGProps<SVGSVGElement>) => (
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
      d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"
    />
  </svg>
);
export default Maximize2;
