#!/usr/bin/env node
// Runs the TypeScript sources directly; the workspace packages are not prebuilt.
import { register } from 'tsx/esm/api';

register();
await import('../src/cli.ts');
