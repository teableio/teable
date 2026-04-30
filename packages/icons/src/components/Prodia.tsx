import * as React from 'react';
import type { SVGProps } from 'react';
const Prodia = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 48 48"
    {...props}
  >
    <path
      fill="currentColor"
      d="M12 0h16c11 0 20 9 20 20v4H24V12H12zM0 12h12v12H0zm12 12h12v12H12zm24 0h12v4c0 11-9 20-20 20h-4V36h12zM0 36h12v12H0z"
    />
  </svg>
);
export default Prodia;
