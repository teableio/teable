#!/usr/bin/env tsx
import { execute, settings } from '@oclif/core';

settings.performanceEnabled = false;

await execute({ dir: import.meta.url });
