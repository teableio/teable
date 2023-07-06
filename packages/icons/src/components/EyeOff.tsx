import * as React from 'react';
import type { SVGProps } from 'react';
const EyeOff = (props: SVGProps<SVGSVGElement>) => (
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
      d="M9.88 9.88a3 3 0 1 0 4.24 4.24M10.73 5.08c.421-.052.845-.08 1.27-.08 7 0 10 7 10 7a13.163 13.163 0 0 1-1.67 2.68"
    />
    <path
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61M2 2l20 20"
    />
  </svg>
);
export default EyeOff;
