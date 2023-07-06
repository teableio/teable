import * as React from 'react';
import type { SVGProps } from 'react';
const PersonStanding = (props: SVGProps<SVGSVGElement>) => (
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
      d="M12 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM9 20l3-6 3 6M6 8l6 2 6-2M12 10v4"
    />
  </svg>
);
export default PersonStanding;
