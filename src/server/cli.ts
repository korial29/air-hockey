#!/usr/bin/env node
import { serve } from './index';

const port = Number(process.env.PORT) || 8787;
serve({ port });
console.log(`air-hockey server on ws://localhost:${port}/<room>`);
