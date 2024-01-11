const instanceCount = Number(process.env.INSTANCE_COUNT ?? '1');
const instanceMaxMemory = process.env.INSTANCE_MAX_MEMORY ?? '4G';

module.exports = {
  apps: [
    {
      name: 'teable',
      script: './dist/index.js',
      cwd: 'apps/nestjs-backend',
      exec_mode: 'cluster',
      max_memory_restart: instanceMaxMemory,
      instances: instanceCount,
      out_file: 'NULL',
    },
  ],
};
