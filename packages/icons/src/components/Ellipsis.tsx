import * as React from 'react';
import type { SVGProps } from 'react';

const Ellipsis = (props: SVGProps<SVGSVGElement>) => (
  <svg
    className="icon"
    style={{
      width: '1em',
      height: '1em',
      verticalAlign: 'middle',
      fill: 'currentColor',
      overflow: 'hidden',
    }}
    viewBox="0 0 1024 1024"
    version="1.1"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M192 512m-64 0a64 64 0 1 0 128 0 64 64 0 1 0-128 0ZM512 512m-64 0a64 64 0 1 0 128 0 64 64 0 1 0-128 0ZM832 512m-64 0a64 64 0 1 0 128 0 64 64 0 1 0-128 0Z" />
  </svg>
);

export default Ellipsis;
