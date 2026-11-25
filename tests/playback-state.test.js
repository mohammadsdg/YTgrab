const test = require('node:test');
const assert = require('node:assert/strict');

test('saved playback restores a bounded queue and position without an autoplay flag', async () => {
  const { readSavedSession } = await import('../client/src/music/playback-state.mjs');
  const song = { id: 'AbCdEfGhI01', title: 'Song', duration: 300 };
  const stored = { getItem: () => JSON.stringify({ current: song, queue: [song], elapsed: 1e10, shuffle: true, repeat: 'one', playing: true }) };
  const session = readSavedSession(stored);
  assert.equal(session.current.id, song.id);
  assert.equal(session.elapsed, 299);
  assert.equal(session.repeat, 'one');
  assert.equal(session.playing, undefined);
  assert.deepEqual(readSavedSession({ getItem: () => '{invalid' }), {});
});

test('seeking and pauses do not count as listening time', async () => {
  const { playedDelta, playedRangeSeconds } = await import('../client/src/music/playback-state.mjs');
  assert.equal(playedDelta(4, 5, false), 1);
  assert.equal(playedDelta(4, 120, false), 0);
  assert.equal(playedDelta(4, 5, true), 0);
  assert.equal(playedRangeSeconds({ length: 2, start: (index) => [0, 120][index], end: (index) => [10, 122][index] }), 12);
});
