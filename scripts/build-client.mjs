/**
 * Bundle the browser half for the DSH client module loader.
 *
 * The loader evaluates a classic script that calls
 * `window.__ModuleLoader__.load({ id, factory(require) })`. esbuild emits the app
 * as CommonJS with React, React DOM and the JSX runtime left as `require(...)`
 * calls; the wrapper below hands those calls to the factory's `require`, which
 * resolves them from the DSH module table. Nothing else is external, so React
 * Flow and its small dependencies are bundled once, here.
 */
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outfile = resolve(root, 'dist/client/index.js');
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));

// Exactly the requests the DSH module table answers; see dsh-client-modules.
const HOST_MODULES = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'];

const result = await build({
  entryPoints: [resolve(root, 'src/client/main.tsx')],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'browser',
  target: ['es2022'],
  jsx: 'automatic',
  external: HOST_MODULES,
  loader: { '.css': 'text' },
  define: { 'process.env.NODE_ENV': '"production"' },
  minify: !process.argv.includes('--no-minify'),
  legalComments: 'eof',
  logLevel: 'warning',
  metafile: true,
});

const body = result.outputFiles[0].text;
// Every bare `require` in the bundle must be one of the host modules; anything
// else would fail at load time inside the DSH page, so fail the build instead.
const stray = [...body.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)]
  .map(match => match[1])
  .filter(request => !HOST_MODULES.includes(request));
if (stray.length > 0) {
  throw new Error(`client bundle requires modules the DSH page does not provide: ${[...new Set(stray)].join(', ')}`);
}

const wrapped = `/* ${pkg.name} ${pkg.version} — built by scripts/build-client.mjs; do not edit. */
(function () {
  window.__ModuleLoader__.load({
    id: ${JSON.stringify(pkg.name)},
    factory(require) {
      var module = { exports: {} };
      var exports = module.exports;
      (function (require, module, exports) {
${body}
      })(require, module, exports);
      return module.exports.plugin;
    },
  });
})();
`;

await mkdir(dirname(outfile), { recursive: true });
await writeFile(outfile, wrapped, 'utf8');
const inputs = Object.keys(result.metafile.inputs);
const size = Buffer.byteLength(wrapped);
console.log(`client: ${outfile.replace(`${root}/`, '')} ${(size / 1024).toFixed(0)} KiB from ${inputs.length} inputs`);
