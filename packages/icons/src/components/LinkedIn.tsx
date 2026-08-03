import * as React from 'react';
import type { SVGProps } from 'react';

interface LinkedInProps extends SVGProps<SVGSVGElement> {
  bgFill?: string;
  fgFill?: string;
}

const LinkedIn = ({ bgFill = '#007EBB', fgFill = 'white', ...props }: LinkedInProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 16 16"
    {...props}
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M2.55556 15H13.4444C14.3036 15 15 14.3036 15 13.4444V2.55556C15 1.69645 14.3036 1 13.4444 1H2.55556C1.69645 1 1 1.69645 1 2.55556V13.4444C1 14.3036 1.69645 15 2.55556 15Z"
      fill={bgFill}
    />
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M12.3333 12.3333H10.5526V9.30035C10.5526 8.46879 10.2366 8.00409 9.57846 8.00409C8.86244 8.00409 8.48835 8.48768 8.48835 9.30035V12.3333H6.77223V6.55555H8.48835V7.33382C8.48835 7.33382 9.00435 6.37903 10.2304 6.37903C11.456 6.37903 12.3333 7.12741 12.3333 8.6752V12.3333ZM4.7249 5.799C4.14035 5.799 3.66667 5.32161 3.66667 4.73283C3.66667 4.14406 4.14035 3.66666 4.7249 3.66666C5.30945 3.66666 5.78284 4.14406 5.78284 4.73283C5.78284 5.32161 5.30945 5.799 4.7249 5.799ZM3.83876 12.3333H5.62824V6.55555H3.83876V12.3333Z"
      fill={fgFill}
    />
  </svg>
);
export default LinkedIn;
