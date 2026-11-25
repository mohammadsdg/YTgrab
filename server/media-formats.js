function mediaSelectionArgs(quality) {
  if (quality === 'audio') return ['-f', 'ba/b'];
  const args = ['-f', 'bv*+ba/b/bv*'];
  if (quality !== 'best') args.push('-S', `res:${quality}`);
  return args;
}

function mediaError(stderr) {
  const message = String(stderr || '').slice(-800);
  if (/Requested format is not available/i.test(message)) {
    return 'YouTube did not offer a playable format for this video. Update yt-dlp and check your cookies or PO-token setup.';
  }
  return message || 'Could not read this YouTube video.';
}

module.exports = { mediaSelectionArgs, mediaError };
