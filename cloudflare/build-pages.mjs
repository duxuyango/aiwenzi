import {mkdir, copyFile, writeFile} from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const output = new URL('build/pages/', root);
await mkdir(output, {recursive: true});
for (const name of ['index.html', 'app.js', 'state.js', 'style.css']) {
  await copyFile(new URL('web/' + name, root), new URL(name, output));
}
await copyFile(new URL('cloudflare/pages-gateway.mjs', root), new URL('_worker.js', output));
await writeFile(new URL('_routes.json', output), JSON.stringify({version: 1, include: ['/*'], exclude: []}));
console.log('Pages build ready: build/pages (4 web assets + gateway).');
