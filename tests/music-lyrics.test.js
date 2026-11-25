const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLrc, parseVtt } = require('../server/music-lyrics');

test('LRC lines keep timestamps and sort multiple stamps', () => {
  assert.deepEqual(parseLrc('[ar:Artist]\n[00:12.50][00:24.250]Hello\n[00:03.1]First'), [
    { time: 3.1, text: 'First' },
    { time: 12.5, text: 'Hello' },
    { time: 24.25, text: 'Hello' }
  ]);
});

test('VTT captions become timed lines without repeated rolling cues', () => {
  assert.deepEqual(parseVtt('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello &amp; hi\n\n00:00:02.000 --> 00:00:03.000\nHello &amp; hi\n\n00:00:03.250 --> 00:00:04.000\n<i>Goodbye</i>'), [
    { time: 1, text: 'Hello & hi' },
    { time: 3.25, text: 'Goodbye' }
  ]);
});
