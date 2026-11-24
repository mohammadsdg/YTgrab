import { useEffect, useRef } from 'react';
import Plyr from 'plyr';
import 'plyr/dist/plyr.css';

export default function HlsPlayer({ src, onError, audioOnly = false }) {
  const hostRef = useRef(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !src) return undefined;
    const video = document.createElement(audioOnly ? 'audio' : 'video');
    video.className = 'video-player';
    video.controls = true;
    video.playsInline = true;
    const handleMediaError = () => {
      if (video.error) onError(video.error.message || `media error code ${video.error.code}`);
    };
    let startCorrected = false;
    const startAtBeginning = () => {
      if (startCorrected) return;
      try {
        if (!video.seekable.length) return;
        video.currentTime = video.seekable.start(0);
        startCorrected = true;
      } catch { /* a later readiness event retries */ }
      video.play().catch(() => {});
    };
    video.addEventListener('error', handleMediaError);
    video.addEventListener('loadedmetadata', startAtBeginning);
    video.addEventListener('loadeddata', startAtBeginning);
    video.addEventListener('canplay', startAtBeginning);
    host.replaceChildren(video);
    let hls;
    let cancelled = false;
    const player = new Plyr(video, {
      controls: ['play-large', 'play', 'progress', 'current-time', 'duration', 'mute', 'volume', 'settings', 'fullscreen'],
      settings: ['speed'],
      seekTime: 10
    });

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
      video.load();
      return () => {
        video.pause();
        video.removeEventListener('error', handleMediaError);
        video.removeEventListener('loadedmetadata', startAtBeginning);
        video.removeEventListener('loadeddata', startAtBeginning);
        video.removeEventListener('canplay', startAtBeginning);
        player.destroy();
        host.replaceChildren();
      };
    }

    import('hls.js').then(({ default: Hls }) => {
      if (cancelled) return;
      if (!Hls.isSupported()) {
        onError('HLS playback is not supported by this browser.');
        return;
      }
      hls = new Hls({ enableWorker: true, lowLatencyMode: false, startPosition: 0 });
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        hls.startLoad(0);
        startAtBeginning();
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          hls.startLoad();
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
        } else {
          onError(`${data.type}: ${data.details}`);
          hls.destroy();
        }
      });
    }).catch((error) => onError(error.message));
    return () => {
      cancelled = true;
      if (hls) hls.destroy();
      video.pause();
      video.removeEventListener('error', handleMediaError);
      video.removeEventListener('loadedmetadata', startAtBeginning);
      video.removeEventListener('loadeddata', startAtBeginning);
      video.removeEventListener('canplay', startAtBeginning);
      player.destroy();
      host.replaceChildren();
    };
  }, [src, audioOnly]);

  return <div ref={hostRef} className={`player-host ${audioOnly ? 'audio-only' : ''}`} />;
}
