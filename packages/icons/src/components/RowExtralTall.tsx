import * as React from 'react';
import type { SVGProps } from 'react';
const RowExtralTall = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      d="M13 2.5C13.5523 2.5 14 2.94772 14 3.5V20C14 20.5523 13.5523 21 13 21H3C2.44772 21 2 20.5523 2 20V3.5C2 2.94772 2.44772 2.5 3 2.5H13ZM4 19H12V4.5H4V19Z"
      fill="currentColor"
    />
    <path
      d="M19 21L19 3M19 21L21 19M19 21L17 19M19 3L17 5M19 3L21 5"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
export default RowExtralTall;
