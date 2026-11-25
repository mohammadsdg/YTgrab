const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readMusicLibrary, putMusicLibrary } = require('../server/music-library-store');

test('legacy library loads without migration and concurrent revisions cannot overwrite each other', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytgrab-library-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'music-library.json');
  fs.writeFileSync(file, JSON.stringify({ liked: [{ id: 'AbCdEfGhI01' }], artists: [], playlists: [], recent: [] }));
  const readJsonFile = (name, fallback) => { try { return JSON.parse(fs.readFileSync(name, 'utf8')); } catch { return fallback; } };
  const writeJsonFile = (name, value) => { const temp = `${name}.tmp`; fs.writeFileSync(temp, JSON.stringify(value)); fs.renameSync(temp, name); };
  const initial = readMusicLibrary(readJsonFile, file);
  assert.equal(initial.revision, 0);
  assert.deepEqual(initial.library.albums, []);
  assert.equal(readMusicLibrary(() => null, file).revision, 0);
  const first = putMusicLibrary({ readJsonFile, writeJsonFile, file, revision: 0,
    library: { ...initial.library, liked: [{ id: 'AbCdEfGhI01' }, { id: 'AbCdEfGhI02' }] } });
  assert.equal(first.revision, 1);
  const stale = putMusicLibrary({ readJsonFile, writeJsonFile, file, revision: 0,
    library: { ...initial.library, artists: [{ id: 'UC1234567890123456789012' }] } });
  assert.equal(stale.conflict, true);
  assert.equal(stale.library.liked.length, 2);
  const rebased = putMusicLibrary({ readJsonFile, writeJsonFile, file, revision: stale.revision,
    library: { ...stale.library, artists: [{ id: 'UC1234567890123456789012' }] } });
  assert.equal(rebased.revision, 2);
  assert.equal(readMusicLibrary(readJsonFile, file).library.liked.length, 2);
  assert.equal(readMusicLibrary(readJsonFile, file).library.artists.length, 1);
});
