#!/bin/bash

node ./apps/nestjs-backend/dist/index.js &
node ./plugins/server.js &
wait -n