#!/bin/bash

node ./apps/nestjs-backend/dist/index.js &
node ./plugins/chart/server.js &
wait -n