function parseLrc(value) {
  const lines = [];
  for (const raw of String(value || '').split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?\]/g)];
    const text = raw.replace(/\[(\d{1,3}):(\d{2})(?:\.\d{1,3})?\]/g, '').trim();
    if (!text) continue;
    for (const stamp of stamps) {
      const fraction = Number(`0.${(stamp[3] || '0').padEnd(3, '0')}`);
      lines.push({ time: Number(stamp[1]) * 60 + Number(stamp[2]) + fraction, text });
    }
  }
  return lines.sort((a, b) => a.time - b.time).slice(0, 500);
}

function parseVtt(value) {
  const lines = [];
  const blocks = String(value || '').split(/\r?\n\s*\r?\n/);
  for (const block of blocks) {
    const rows = block.trim().split(/\r?\n/);
    const cue = rows.findIndex((row) => row.includes('-->'));
    if (cue < 0) continue;
    const start = rows[cue].match(/(?:(\d+):)?(\d{2}):(\d{2})\.(\d{3})\s*-->/);
    if (!start) continue;
    const time = Number(start[1] || 0) * 3600 + Number(start[2]) * 60 + Number(start[3]) + Number(start[4]) / 1000;
    const text = rows.slice(cue + 1).join(' ').replace(/<[^>]*>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
    if (text && lines[lines.length - 1]?.text !== text) lines.push({ time, text });
  }
  return lines.slice(0, 500);
}

module.exports = { parseLrc, parseVtt };
