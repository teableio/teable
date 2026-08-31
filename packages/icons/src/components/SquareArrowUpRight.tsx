import * as React from 'react';
import type { SVGProps } from 'react';
const SquareArrowUpRight = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 24 24"
    data-rtl-flip=""
    {...props}
  >
    <path
      d="M20 5C20 4.44771 19.5523 4 19 4H5C4.44772 4 4 4.44772 4 5V19C4 19.5523 4.44771 20 5 20H19C19.5523 20 20 19.5523 20 19V5ZM17 16C17 16.5523 16.5523 17 16 17C15.4477 17 15 16.5523 15 16V10.4141L8.70703 16.707C8.31651 17.0976 7.68349 17.0976 7.29297 16.707C6.90244 16.3165 6.90244 15.6835 7.29297 15.293L13.5859 9H8C7.44772 9 7 8.55228 7 8C7 7.44772 7.44772 7 8 7H16C16.5523 7 17 7.44772 17 8V16ZM22 19C22 20.6569 20.6569 22 19 22H5C3.34315 22 2 20.6569 2 19V5C2 3.34315 3.34315 2 5 2H19C20.6569 2 22 3.34315 22 5V19Z"
      fill="currentColor"
    />
  </svg>
);
export default SquareArrowUpRight;
