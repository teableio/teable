import * as React from 'react';
import type { SVGProps } from 'react';
const Asterisk = (props: SVGProps<SVGSVGElement>) => (
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
      d="M12 6v12M17.196 9 6.804 15M6.804 9l10.392 6"
    />
  </svg>
);
export default Asterisk;
