import * as React from 'react';
import type { SVGProps } from 'react';
const Checked = (props: SVGProps<SVGSVGElement>) => (
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
      d="M12.667 2H3.333C2.593 2 2 2.6 2 3.333v9.334C2 13.4 2.593 14 3.333 14h9.334c.74 0 1.333-.6 1.333-1.333V3.333C14 2.6 13.407 2 12.667 2m-6 9.333L3.333 8l.94-.94 2.394 2.387 5.06-5.06.94.946z"
    />
  </svg>
);
export default Checked;
