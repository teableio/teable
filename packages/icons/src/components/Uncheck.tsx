import * as React from 'react';
import type { SVGProps } from 'react';
const Uncheck = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 16 16"
    {...props}
  >
    <path
      fill="currentColor"
      d="M12.667 3.333v9.334H3.333V3.333h9.334Zm0-1.333H3.333C2.6 2 2 2.6 2 3.333v9.334C2 13.4 2.6 14 3.333 14h9.334C13.4 14 14 13.4 14 12.667V3.333C14 2.6 13.4 2 12.667 2Z"
    />
  </svg>
);
export default Uncheck;
