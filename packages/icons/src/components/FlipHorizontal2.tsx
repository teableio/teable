import * as React from 'react';
import type { SVGProps } from 'react';
const FlipHorizontal2 = (props: SVGProps<SVGSVGElement>) => (
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
      d="m3 7 5 5-5 5V7ZM21 7l-5 5 5 5V7ZM12 20v2M12 14v2M12 8v2M12 2v2"
    />
  </svg>
);
export default FlipHorizontal2;
