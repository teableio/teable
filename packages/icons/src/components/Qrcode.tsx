import * as React from 'react';
import type { SVGProps } from 'react';
const Qrcode = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      fill="currentColor"
      d="M15.846 15.846h3.077V12.77H22v4.616h-3.077v1.538h-3.077v-1.538H12.77v-4.616h3.077zM2 12.77h9.23V22H2zm3.077 3.077v3.077h3.077v-3.077zM2 2h9.23v9.23H2zm3.077 3.077v3.077h3.077V5.077zM12.769 2H22v9.23h-9.23zm3.077 3.077v3.077h3.077V5.077zm3.077 13.846H22V22h-3.077zm-6.154 0h3.077V22H12.77z"
    />
  </svg>
);
export default Qrcode;
