import * as React from 'react';
import type { SVGProps } from 'react';
const AlignCenterHorizontal = (props: SVGProps<SVGSVGElement>) => (
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
      d="M2 12h20M10 16v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4M10 8V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v4M20 16v1a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v-1M14 8V7c0-1.1.9-2 2-2h2a2 2 0 0 1 2 2v1"
    />
  </svg>
);
export default AlignCenterHorizontal;
