#!/usr/bin/env zx

const nextjsDir = process.env.NEXTJS_DIR ?? 'apps/nextjs-app';

await $`NEXTJS_DIR=${nextjsDir} node apps/nestjs-backend/dist/index.js`;
