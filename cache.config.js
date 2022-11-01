/**
 * Convenience script to harmonize cache directories across various
 * tooling such as eslint and jest.
 *
 * Recently more & more tools like babel-loader tend to cache in
 * node_modules/.cache (@link https://github.com/avajs/find-cache-dir)
 * It's possible too.
 */
// @ts-check
'use strict';

const { resolve } = require('path');

const globalCachePath = resolve(`${__dirname}/.cache`);

/**
 * @param {string} packageName
 * @returns string
 */
function sanitize(packageName) {
  return packageName.replace('/', '.').replace(/[^a-z0-9.@_-]+/gi, '-');
}

/**
 * @param {string} packageName
 * @returns string
 */
function getEslintCachePath(packageName) {
  return `${globalCachePath}/${sanitize(packageName)}/eslint`;
}

/**
 * @param {string} packageName
 * @returns string
 */
function getJestCachePath(packageName) {
  return `${globalCachePath}/${sanitize(packageName)}/jest`;
}

module.exports = {
  getJestCachePath,
  getEslintCachePath,
};
