import * as React from 'react';
import type { SVGProps } from 'react';
const Xai = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <rect width={24} height={24} fill="currentColor" rx={4} />
    <path
      fill="#fff"
      d="m4.004 9.928 7.592 10.843h3.375L7.378 9.928zM7.375 15.95 4 20.77h3.377l1.687-2.408zM15.743 4l-5.835 8.333 1.688 2.412L19.12 4zM16.354 9.156V20.77h2.766V5.206z"
    />
  </svg>
);
export default Xai;
