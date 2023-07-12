function componentTemplate({ template }, opts, { imports, componentName, props, jsx, exports }) {
  const code = `
    %%NEWLINE%%
    %%NEWLINE%%

    import * as React from 'react';
    import { IconProps } from '../../types';
    import { IconWrapper } from '../IconWrapper';

    %%NEWLINE%%

    const %%COMPONENT_NAME%% = (allProps: IconProps) => {
      const { svgProps: props, ...restProps } = allProps;
      return <IconWrapper icon={%%JSX%%} {...restProps} />
    };

    %%EXPORTS%%
  `;

  const mapping = {
    COMPONENT_NAME: componentName,
    JSX: jsx,
    EXPORTS: exports,
    NEWLINE: '\n',
  };

  /**
   * API Docs: https://babeljs.io/docs/en/babel-template#api
   */
  const typeScriptTpl = template(code, {
    plugins: ['jsx', 'typescript'],
    preserveComments: true,
    syntacticPlaceholders: true,
  });

  return typeScriptTpl(mapping);
}

module.exports = componentTemplate;
