// Fails when a gzipped browser entry, shared chunks included, grows past its budget.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGETS = [
  { file: 'dist/index.js', max: 8 * 1024 },
  { file: 'dist/local.js', max: 4 * 1024 },
];

// An entry plus every chunk it statically imports, concatenated.
const collect = (file, seen = new Set()) => {
  if (seen.has(file)) {
    return '';
  }
  seen.add(file);
  const src = readFileSync(file, 'utf8');
  const deps = [...src.matchAll(/from\s*["'](\.\/[^"']+)["']|import\s*["'](\.\/[^"']+)["']/g)];
  return src + deps.map(m => collect(join(dirname(file), m[1] ?? m[2]), seen)).join('');
};

let failed = false;
for (const { file, max } of BUDGETS) {
  const raw = collect(file);
  const gz = gzipSync(raw, { level: 9 }).length;
  const ok = gz <= max;
  failed ||= !ok;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${file}: ${raw.length} B raw, ${gz} B gzip (budget ${max} B)`,
  );
}
process.exit(failed ? 1 : 0);
