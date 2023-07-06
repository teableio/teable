import * as React from 'react';
import type { SVGProps } from 'react';
const BellPlus = (props: SVGProps<SVGSVGElement>) => (
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
      d="M18.387 12C19.198 15.799 21 17 21 17H3s3-2 3-9a6 6 0 0 1 7-5.916M13.73 21a1.999 1.999 0 0 1-3.46 0M18 2v6M21 5h-6"
    />
  </svg>
);
export default BellPlus;
