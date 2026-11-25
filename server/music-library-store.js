const EMPTY_LIBRARY = { liked: [], artists: [], albums: [], playlists: [], recent: [] };

function readMusicLibrary(readJsonFile, file) {
  const raw = readJsonFile(file, {});
  const stored = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    library: { ...EMPTY_LIBRARY, ...stored },
    revision: Number.isSafeInteger(stored.revision) && stored.revision >= 0 ? stored.revision : 0
  };
}

// The comparison and synchronous atomic write run in one Node event-loop turn.
// A second browser must rebase its change instead of replacing the first one's data.
function putMusicLibrary({ readJsonFile, writeJsonFile, file, revision, library }) {
  const current = readMusicLibrary(readJsonFile, file);
  if (!Number.isSafeInteger(revision) || revision !== current.revision) {
    return { conflict: true, ...current };
  }
  const next = { ...library, revision: revision + 1 };
  writeJsonFile(file, next);
  return { conflict: false, library: next, revision: next.revision };
}

module.exports = { EMPTY_LIBRARY, readMusicLibrary, putMusicLibrary };
