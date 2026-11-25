const path = require('path');
const fs = require('fs');

function findSavedAudio(id, directory, metadata) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
  const isRegularFile = (name) => {
    try { return fs.lstatSync(path.join(directory, name)).isFile(); }
    catch { return false; }
  };
  const entry = Object.entries(metadata || {}).find(([name, info]) =>
    info?.id === id && (info.quality === 'audio' || (!info.quality && /\.(m4a|mp3|aac|opus|ogg|webm)$/i.test(name)))
    && /\.(m4a|mp3|aac|opus|ogg|webm)$/i.test(name)
    && path.basename(name) === name && isRegularFile(name));
  return entry ? path.join(directory, entry[0]) : null;
}

module.exports = { findSavedAudio };
