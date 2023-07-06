import * as React from 'react';
import type { SVGProps } from 'react';
const LightbulbOff = (props: SVGProps<SVGSVGElement>) => (
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
      d="M9 18h6M10 22h4M2 2l20 20M9 2.804A6 6 0 0 1 18 8a4.65 4.65 0 0 1-1.03 3M8.91 14a4.61 4.61 0 0 0-1.41-2.5C6.23 10.23 6 9 6 8a6 6 0 0 1 .084-1"
    />
  </svg>
);
export default LightbulbOff;
