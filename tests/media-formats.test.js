const test = require('node:test');
const assert = require('node:assert/strict');
const { mediaSelectionArgs, mediaError } = require('../server/media-formats');

test('audio selects the best audio format and unavailable formats get a useful message', () => {
  assert.deepEqual(mediaSelectionArgs('audio'), ['-f', 'ba/b']);
  assert.match(mediaError('ERROR: Requested format is not available'), /playable format/);
});

test('raw provider diagnostics are not sent to the ordinary interface', () => {
  const secret = 'sensitive-provider-token';
  assert.doesNotMatch(mediaError(`Something failed: ${secret}`), /sensitive-provider-token/);
});
