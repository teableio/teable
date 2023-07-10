import * as React from 'react';
import type { SVGProps } from 'react';
const BellMinus = (props: SVGProps<SVGSVGElement>) => (
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
      d="M13.73 21a1.999 1.999 0 0 1-3.46 0M21 5h-6M18.021 9C18.29 15.193 21 17 21 17H3s3-2 3-9a6 6 0 0 1 7-5.916"
    />
  </svg>
);
export default BellMinus;
