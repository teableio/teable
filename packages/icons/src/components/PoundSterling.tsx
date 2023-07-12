import * as React from 'react';
import type { SVGProps } from 'react';
const PoundSterling = (props: SVGProps<SVGSVGElement>) => (
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
      d="M18 7c0-5.333-8-5.333-8 0M10 7v14M6 21h12M6 13h10"
    />
  </svg>
);
export default PoundSterling;
