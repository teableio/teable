import * as React from 'react';
import type { SVGProps } from 'react';
const BarChart3 = (props: SVGProps<SVGSVGElement>) => (
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
      d="M3 3v18h18M18 17V9M13 17V5M8 17v-3"
    />
  </svg>
);
export default BarChart3;
