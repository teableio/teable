const { extendZodWithOpenApi } = require('@asteasolutions/zod-to-openapi');
const dayjs = require('dayjs');
const timezone = require('dayjs/plugin/timezone');
const utc = require('dayjs/plugin/utc');
const { z } = require('zod');

extendZodWithOpenApi(z);
dayjs.extend(utc);
dayjs.extend(timezone);
