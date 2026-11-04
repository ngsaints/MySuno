const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { getMusicModels } = require('../lib/music-models.cjs');
const OUTPUT = path.resolve(__dirname, '../dist/web');
const SOURCE = path.resolve(__dirname, '../src');
async function files(directory, prefix = '') {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) result.push(...await files(path.join(directory, entry.name), relative + '/'));
    else result.push(relative);
  }
  return result.sort();
}
async function build() {
  const projectRoot = path.resolve(__dirname, '..');
  if (path.relative(projectRoot, OUTPUT) !== path.join('dist', 'web')) throw new Error('Invalid output directory');
  await fs.rm(OUTPUT, { recursive: true, force: true });
  await fs.mkdir(OUTPUT, { recursive: true });
  await fs.cp(SOURCE, OUTPUT, { recursive: true });
  const index = await fs.readFile(path.join(OUTPUT, 'index.html'), 'utf8');
  await fs.writeFile(path.join(OUTPUT, 'index.html'), index.replace('name="mysuno-static" content="false"', 'name="mysuno-static" content="true"'));
  await fs.mkdir(path.join(OUTPUT, 'data'), { recursive: true });
  await fs.writeFile(path.join(OUTPUT, 'data/music-models.json'), JSON.stringify(await getMusicModels(), null, 2));
  await fs.writeFile(path.join(OUTPUT, '.nojekyll'), '');
  const shell = (await files(OUTPUT)).filter(file => !['sw.js', 'version.json', 'data/music-models.json', '.nojekyll'].includes(file));
  const hash = crypto.createHash('sha256');
  for (const file of shell) hash.update(await fs.readFile(path.join(OUTPUT, file)));
  const version = require('../package.json').version + '-' + hash.digest('hex').slice(0, 12);
  const sw = await fs.readFile(path.join(SOURCE, 'sw.js'), 'utf8');
  await fs.writeFile(path.join(OUTPUT, 'sw.js'), sw.replace("'__MYSUNO_VERSION__'", JSON.stringify(version)).replace('/* __MYSUNO_SHELL__ */ []', JSON.stringify(shell.map(file => './' + file))));
  await fs.writeFile(path.join(OUTPUT, 'version.json'), JSON.stringify({ version, builtAt: new Date().toISOString() }));
  console.log('PWA built:', version, '→', OUTPUT);
}
build().catch(error => { console.error('[MySuno] Build:', error.message); process.exit(1); });
