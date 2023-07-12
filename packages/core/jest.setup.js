const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const { extendZodWithOpenApi } = require('@asteasolutions/zod-to-openapi');
const { z } = require('zod');
const dayjs = require('dayjs');

extendZodWithOpenApi(z);
dayjs.extend(utc);
dayjs.extend(timezone);
