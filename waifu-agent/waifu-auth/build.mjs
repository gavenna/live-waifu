import { build } from 'esbuild';
import { readdirSync } from 'fs';
import { join, basename } from 'path';

const srcDir = 'api-src';
const outDir = 'api';

const entryPoints = readdirSync(srcDir)
  .filter(f => f.endsWith('.ts') && !f.startsWith('_'))
  .map(f => join(srcDir, f));

for (const entry of entryPoints) {
  const name = basename(entry, '.ts');
  await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: `${outDir}/${name}.js`,
    packages: 'external',
    sourcemap: false,
  });
}

console.log(`Bundled ${entryPoints.length} functions to ${outDir}/`);
