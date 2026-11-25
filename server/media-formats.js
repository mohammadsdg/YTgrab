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
  if (/LOGIN_REQUIRED|sign in|cookies|authentication/i.test(message)) return 'YouTube asked the server to sign in. Check the server cookies.';
  if (/private video|video unavailable|not available/i.test(message)) return 'This video is unavailable from the server.';
  if (/timed out|connection|network|HTTP Error 403/i.test(message)) return 'The server could not reach this media. Try again shortly.';
  return 'Could not retrieve this media. Try another quality or check server diagnostics.';
}

module.exports = { mediaSelectionArgs, mediaError };
