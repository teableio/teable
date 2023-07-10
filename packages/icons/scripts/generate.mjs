import path from 'path';
import { transform } from '@svgr/core';
import axios from 'axios';
import chalk from 'chalk';
import dotenv from 'dotenv';
import figmaApiExporter from 'figma-api-exporter';
import fs from 'fs-extra';
import _ from 'lodash';
dotenv.config();

// Add .env file
const FIGMA_API_TOKEN = process.env.FIGMA_API_TOKEN;
const FIGMA_FILE_ID = process.env.FIGMA_FILE_ID;
const FIGMA_CANVAS = process.env.FIGMA_CANVAS;

if (!FIGMA_API_TOKEN) {
  throw new Error('Missing environment variable FIGMA_API_TOKEN');
}

if (!FIGMA_FILE_ID) {
  throw new Error('Missing environment variable FIGMA_FILE_ID');
}

if (!FIGMA_CANVAS) {
  throw new Error('Missing environment variable FIGMA_CANVAS');
}

const figmaApi = figmaApiExporter.default(FIGMA_API_TOKEN);

const downloadSVGsData = async (data) => {
  return Promise.all(
    data.map(async (dataItem) => {
      const downloadedSvg = await axios.get(dataItem.url);
      return {
        ...dataItem,
        data: downloadedSvg.data,
      };
    })
  );
};

const transformReactComponent = (svgList) => {
  svgList.forEach((svg) => {
    const svgCode = svg.data;
    const svgName = svg.name.split('/').pop();
    const camelCaseInput = _.camelCase(svgName);
    const componentName = camelCaseInput.charAt(0).toUpperCase() + camelCaseInput.slice(1);
    const componentFileName = `${componentName}.tsx`;

    // Converts SVG code into React code using SVGR library
    const componentCode = transform.sync(
      svgCode,
      {
        typescript: true,
        icon: true,
        replaceAttrValues: {
          '#000': 'currentColor',
        },
        plugins: [
          // Clean SVG files using SVGO
          '@svgr/plugin-svgo',
          // Generate JSX
          '@svgr/plugin-jsx',
          // Format the result using Prettier
          '@svgr/plugin-prettier',
        ],
      },
      { componentName }
    );
    // 6. Write generated component to file system
    fs.outputFileSync(path.resolve('src/components', componentFileName), componentCode);
    // fs.outputFileSync(path.resolve('src/icons', `${svgName}.svg`), svg.data);
  });
};

const genIndexContent = () => {
  let indexContent = '';
  const componentsDir = path.resolve('src/components');
  const indexPath = path.resolve('src/index.ts');

  fs.readdirSync(componentsDir).forEach((componentFileName) => {
    // Convert name to pascal case
    const componentName = componentFileName.split('.')[0];

    // Export statement
    const componentExport = `export { default as ${componentName} } from './components/${componentName}';\n`;

    indexContent += componentExport;
  });

  // Write the content to file system
  fs.writeFileSync(indexPath, indexContent);
};

const generate = async () => {
  // console.log(chalk.magentaBright('-> Fetching icons metadata'));
  // const { svgs } = await figmaApi.getSvgs({ fileId: FIGMA_FILE_ID, canvas: FIGMA_CANVAS });
  // console.log(chalk.blueBright('-> Downloading SVG code'));
  // const svgsData = await downloadSVGsData(svgs);
  // console.log(chalk.cyanBright('-> Converting to React components'));
  // transformReactComponent(svgsData);
  console.log(chalk.yellowBright('-> Writing exports components'));
  genIndexContent();
  console.log(chalk.greenBright('-> All done! ✅'));
};

generate();
