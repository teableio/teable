/**
 * An example declaration for svg if you're relying on https://react-svgr.com/
 * and @svgr/webpack equivalent strategy.
 *
 * This definition will improve type completion experience.
 *
 * @link {https://github.com/gregberge/svgr/issues/546|For issue followup}
 * @link {https://github.com/gregberge/svgr/pull/573|To follow upcoming improvements}
 *
 * If you're NOT using @svgr/webpack, be sure the svg definition is equivalent to
 *
 * ```
 * declare module "*.svg" {
 *   const svg: string;
 *   export default svg;
 * }
 * ```
 */

declare module '*.svg' {
  import type React from 'react';
  const svg: React.VFC<React.SVGProps<SVGSVGElement>>;
  export default svg;
}
