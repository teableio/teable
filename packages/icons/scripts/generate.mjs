import path from 'path';
import { transform } from '@svgr/core';
import axios from 'axios';
import chalk from 'chalk';
import dotenv from 'dotenv';
import fs from 'fs-extra';
import _ from 'lodash';
import * as Figma from 'figma-js';

dotenv.config();

const componentsDir = 'src/components';

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

const figmaApi = Figma.Client({ personalAccessToken: FIGMA_API_TOKEN });

const getSvgs = async ({ fileId, canvas, group }) => {
  const file = await figmaApi.file(fileId);
  const { document } = file.data;
  const iconsNode = document.children.find(({ name }) => name === canvas);
  if (!iconsNode) {
    throw new Error(`Couldn't find page with name ${canvas}`);
  }
  const usingIconNodes = iconsNode.children.find(({ name }) => name === group)?.children || [];
  const usingNodeId = usingIconNodes.map(({ id }) => id);
  const svgs = await figmaApi.fileImages(fileId, {
    format: 'svg',
    ids: usingNodeId,
  });
  return usingIconNodes.map(({ id, name }) => ({ id, name, url: svgs.data.images[id] }));
};

const downloadSVGsData = async (data, batchSize = 20, delayBetweenBatches = 500) => {
  const results = [];
  const batchCount = Math.ceil(data.length / batchSize);

  for (let i = 0; i < batchCount; i++) {
    const batchData = data.slice(i * batchSize, (i + 1) * batchSize);

    console.log(`Processing batch ${i + 1}/${batchCount}, containing ${batchData.length} requests`);

    const batchResults = await Promise.all(
      batchData.map(async (dataItem) => {
        try {
          const downloadedSvg = await axios.get(dataItem.url);
          return {
            ...dataItem,
            data: downloadedSvg.data,
            success: true,
          };
        } catch (error) {
          console.error(`Failed to download ${dataItem.url}:`, error.message);
          return {
            ...dataItem,
            success: false,
          };
        }
      })
    );

    results.push(...batchResults);

    if (i < batchCount - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayBetweenBatches));
    }
  }

  return results;
};

const transformReactComponent = (svgList) => {
  if (!fs.existsSync(componentsDir)) {
    fs.mkdirSync(componentsDir);
  }
  svgList.forEach((svg) => {
    if (!svg.success) return;
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
          [
            '@svgr/plugin-svgo',
            {
              multipass: true,
              plugins: [
                {
                  name: 'prefixIds',
                  params: {
                    prefix: componentName.toLowerCase(),
                    delim: '_',
                  },
                },
              ],
            },
          ],
          // Generate JSX
          '@svgr/plugin-jsx',
          // Format the result using Prettier
          '@svgr/plugin-prettier',
        ],
      },
      { componentName }
    );
    // 6. Write generated component to file system
    fs.outputFileSync(path.resolve(componentsDir, componentFileName), componentCode);
    // fs.outputFileSync(path.resolve('src/icons', `${svgName}.svg`), svg.data);
  });
};

const genIndexContent = () => {
  let indexContent = '';
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
  console.log(chalk.magentaBright('-> Fetching icons metadata'));
  const svgs = await getSvgs({ fileId: FIGMA_FILE_ID, canvas: FIGMA_CANVAS, group: 'using' });
  console.log(chalk.blueBright('-> Downloading SVG code'));
  const svgsData = await downloadSVGsData(svgs);
  console.log(chalk.cyanBright('-> Converting to React components'));
  transformReactComponent(svgsData);
  console.log(chalk.yellowBright('-> Writing exports components'));
  genIndexContent();
  console.log(chalk.greenBright('-> All done! ✅'));
};

generate();
