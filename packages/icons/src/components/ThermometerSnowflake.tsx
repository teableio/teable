import * as React from 'react';
import type { SVGProps } from 'react';
const ThermometerSnowflake = (props: SVGProps<SVGSVGElement>) => (
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
      d="M2 12h10M9 4v16M3 9l3 3-3 3M12 6 9 9 6 6M6 18l3-3 1.5 1.5M20 4v10.54a4 4 0 1 1-4 0V4a2 2 0 1 1 4 0Z"
    />
  </svg>
);
export default ThermometerSnowflake;
