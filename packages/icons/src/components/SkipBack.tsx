import * as React from 'react';
import type { SVGProps } from 'react';
const SkipBack = (props: SVGProps<SVGSVGElement>) => (
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
      d="M19 20 9 12l10-8v16ZM5 19V5"
    />
  </svg>
);
export default SkipBack;
