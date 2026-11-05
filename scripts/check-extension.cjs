const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const exists = p => assert.ok(fs.existsSync(path.join(root, p)), `Missing: ${p}`);
const manifest = JSON.parse(read('manifest.json'));
assert.equal(manifest.manifest_version, 3);
assert.deepEqual(manifest.permissions, ['storage', 'activeTab']);
assert.ok(!manifest.background && !manifest.externally_connectable);
exists(manifest.action.default_popup);
for (const script of manifest.content_scripts[0].js) exists(script);
const context = vm.createContext({}); vm.runInContext(read('src/data/runtime-assets.js'), context);
const assets = context.DGP.assets;
let images = 0;
for (const character of Object.values(assets.characters)) {
  assert.ok(character.sprites[character.defaultSprite]);
  for (const key of Object.values(character.expressions || {})) assert.ok(character.sprites[key], `Missing expression: ${key}`);
  for (const [key, values] of Object.entries(character.bounds || {})) {
    assert.ok(character.sprites[key]);
    const [width, height, x, y, w, h] = values;
    assert.ok(values.length === 6 && values.every(Number.isFinite) && w > 0 && h > 0 && x >= 0 && y >= 0 && x + w <= width && y + h <= height, `Invalid bounds: ${key}`);
  }
  for (const p of Object.values(character.sprites)) { assert.ok(p.startsWith('public/assets/')); exists(p); images++; }
}
for (const bg of Object.values(assets.backgrounds)) { assert.ok(bg.path.startsWith('public/assets/backgrounds/')); exists(bg.path); images++; }
for (const dir of ['src', 'scripts', 'tests', 'public']) {
  for (const entry of fs.readdirSync(path.join(root, dir), {recursive: true})) {
    if (!/\.(?:js|cjs)$/.test(entry)) continue;
    const file = path.join(root, dir, entry);
    const result = cp.spawnSync(process.execPath, ['--check', file], {encoding: 'utf8'});
    assert.equal(result.status, 0, `${file}\n${result.stderr}`);
  }
}
for (const p of ['START_HERE.txt', 'PROJECT_DESCRIPTION.txt', 'instructions/CHATGPT_PROJECT_INSTRUCTIONS.txt',
  'instructions/ASSET_CATALOG.txt', 'public/demo.html', 'src/ui/styles/player.css']) exists(p);
const catalog = JSON.parse(read('src/data/backgrounds.json')).backgrounds;
assert.equal(catalog.length, Object.keys(assets.backgrounds).length);
assert.ok(read('instructions/CHATGPT_PROJECT_INSTRUCTIONS.txt').length < 8000, 'Keep project instructions concise');
console.log(`Manifest, JavaScript syntax and ${images} asset paths verified.`);
