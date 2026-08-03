import * as React from 'react';
import type { SVGProps } from 'react';
const Zap = (props: SVGProps<SVGSVGElement>) => (
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
      d="M13 2 3 14h9l-1 8 10-12h-9z"
    />
  </svg>
);
export default Zap;
