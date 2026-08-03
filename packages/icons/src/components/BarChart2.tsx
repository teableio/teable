import * as React from 'react';
import type { SVGProps } from 'react';
const BarChart2 = (props: SVGProps<SVGSVGElement>) => (
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
      d="M18 20V10M12 20V4M6 20v-6"
    />
  </svg>
);
export default BarChart2;
