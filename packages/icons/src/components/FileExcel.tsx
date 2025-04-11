import * as React from 'react';
import type { SVGProps } from 'react';
const FileExcel = (props: SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    fill="none"
    viewBox="0 0 24 24"
    {...props}
  >
    <g clipPath="url(#prefix__file-excel)">
      <path fill="#21A366" d="M16 1H7c-.6 0-1 .4-1 1v5l10 5 4 1.5 4-1.5V7z" />
      <path fill="#107C41" d="M6 7h10v5H6z" />
      <path fill="#33C481" d="M24 2v5h-8V1h7c.5 0 1 .5 1 1" />
      <path fill="#185C37" d="M16 12H6v10c0 .6.4 1 1 1h16c.6 0 1-.4 1-1v-5z" />
      <path
        fill="currentColor"
        d="M13.8 6H6v14h7.6c.7 0 1.4-.7 1.4-1.4V7.2c0-.7-.5-1.2-1.2-1.2"
        opacity={0.5}
      />
      <path
        fill="#107C41"
        d="M12.8 19H1.2C.5 19 0 18.5 0 17.8V6.2C0 5.5.5 5 1.2 5h11.7c.6 0 1.1.5 1.1 1.2v11.7c0 .6-.5 1.1-1.2 1.1"
      />
      <path
        fill="#fff"
        d="M3.4 16 6 12 3.6 8h1.9l1.3 2.5c.2.3.2.5.3.6l.3-.6L8.8 8h1.8l-2.4 4 2.5 4h-2l-1.5-2.8c0-.1-.1-.2-.2-.4 0 .1-.1.2-.2.4L5.3 16z"
      />
      <path fill="#107C41" d="M16 12h8v5h-8z" />
    </g>
    <defs>
      <clipPath id="prefix__file-excel">
        <path fill="#fff" d="M0 0h24v24H0z" />
      </clipPath>
    </defs>
  </svg>
);
export default FileExcel;
