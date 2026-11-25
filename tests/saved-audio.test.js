const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findSavedAudio } = require('../server/saved-audio');

test('only compatible saved audio is reused', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytgrab-audio-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'song.m4a'), 'audio');
  fs.writeFileSync(path.join(dir, 'video.mp4'), 'video');
  const metadata = {
    'song.m4a': { id: 'AbCdEfGhI01', quality: 'audio' },
    'video.mp4': { id: 'AbCdEfGhI02', quality: '720' },
    '../outside.m4a': { id: 'AbCdEfGhI03', quality: 'audio' }
  };
  assert.equal(findSavedAudio('AbCdEfGhI01', dir, metadata), path.join(dir, 'song.m4a'));
  assert.equal(findSavedAudio('AbCdEfGhI02', dir, metadata), null);
  assert.equal(findSavedAudio('AbCdEfGhI03', dir, metadata), null);
  assert.equal(findSavedAudio('../../etc', dir, metadata), null);
});
