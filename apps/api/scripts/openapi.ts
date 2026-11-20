/** Writes apps/api/openapi.json, the server's exact description (see src/openapi.ts). */
import fs from 'node:fs';
import path from 'node:path';
import { describeApi } from '../src/openapi';

const out = path.resolve(__dirname, '../openapi.json');
fs.writeFileSync(out, JSON.stringify(describeApi(), null, 2) + '\n');
console.log('wrote', path.relative(process.cwd(), out));
