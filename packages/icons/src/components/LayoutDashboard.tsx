import * as React from 'react';
import type { SVGProps } from 'react';
const LayoutDashboard = (props: SVGProps<SVGSVGElement>) => (
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
      d="M10 3H3v9h7V3ZM21 3h-7v5h7V3ZM21 12h-7v9h7v-9ZM10 16H3v5h7v-5Z"
    />
  </svg>
);
export default LayoutDashboard;
