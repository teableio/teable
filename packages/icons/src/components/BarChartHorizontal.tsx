import * as React from 'react';
import type { SVGProps } from 'react';
const BarChartHorizontal = (props: SVGProps<SVGSVGElement>) => (
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
      d="M3 3v18h18M7 16h8M7 11h12M7 6h3"
    />
  </svg>
);
export default BarChartHorizontal;
