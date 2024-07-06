import * as React from 'react';
import type { SVGProps } from 'react';
const ScheduledTime = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <path fill="currentColor" d="M7.85 3h2v4h-2zm6 0h2v4h-2z" />
    <path
      fill="currentColor"
      d="M12.5 19H6c-.55 0-1-.45-1-1v-8h14v1.85c.85.45 1.55 1.1 2 1.9V6c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v13c0 1.1.9 2 2 2h10.05a4.8 4.8 0 0 1-2.55-2M5 7c0-.55.45-1 1-1h12c.55 0 1 .45 1 1v1H5z"
    />
    <path
      fill="#2684FF"
      d="M16.65 11.25c-2.75 0-5 2.25-5 5s2.25 5 5 5 5-2.25 5-5-2.25-5-5-5m0 8c-1.65 0-3-1.35-3-3s1.35-3 3-3 3 1.35 3 3c0 1.7-1.35 3-3 3"
    />
    <path fill="#2684FF" d="M16 13.75h1.5v3H16z" />
    <path fill="#2684FF" d="M15.977 16.773v-1.5h3v1.5z" />
  </svg>
);
export default ScheduledTime;
