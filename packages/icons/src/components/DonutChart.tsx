import * as React from 'react';
import type { SVGProps } from 'react';
const DonutChart = (props: SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 1025 1024"
    xmlns="http://www.w3.org/2000/svg"
    width="1em"
    height="1em"
    {...props}
  >
    <path d="M753.664 511.104a240.64 240.64 0 0 1-52.992 151.04l100.992 101.056A384.128 384.128 0 0 0 538.432 128v142.912a241.728 241.728 0 0 1 215.232 240.192z"></path>
    <path d="M512 752.768a241.728 241.728 0 0 1-26.56-481.92V128a384.064 384.064 0 1 0 278.848 672.704l-101.056-101.12A240.512 240.512 0 0 1 512 752.768z"></path>
  </svg>
);
export default DonutChart;
