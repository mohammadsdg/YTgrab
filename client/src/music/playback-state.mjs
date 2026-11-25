export function readSavedSession(storage) {
  try {
    const data = JSON.parse(storage.getItem('ytgrab_music_session') || '{}');
    if (!/^[A-Za-z0-9_-]{11}$/.test(data.current?.id) || !Array.isArray(data.queue)) return {};
    const queue = data.queue.filter((item) => /^[A-Za-z0-9_-]{11}$/.test(item?.id)).slice(0, 500);
    if (!queue.some((item) => item.id === data.current.id)) return {};
    return {
      current: data.current, queue,
      elapsed: Number.isFinite(data.elapsed) ? Math.max(0, Math.min(data.elapsed, Number.isFinite(data.current.duration) ? Math.max(0, data.current.duration - 1) : 24 * 60 * 60)) : 0,
      shuffle: Boolean(data.shuffle), repeat: ['off', 'all', 'one'].includes(data.repeat) ? data.repeat : 'off'
    };
  } catch { return {}; }
}

export function playedDelta(previous, current, paused) {
  const delta = current - previous;
  return !paused && delta > 0 && delta < 2.5 ? delta : 0;
}

export function playedRangeSeconds(ranges) {
  let seconds = 0;
  for (let index = 0; index < ranges.length; index++) seconds += Math.max(0, ranges.end(index) - ranges.start(index));
  return seconds;
}
