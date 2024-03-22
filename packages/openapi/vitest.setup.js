const { extendZodWithOpenApi } = require('@asteasolutions/zod-to-openapi');
const { z } = require('zod');

extendZodWithOpenApi(z);
