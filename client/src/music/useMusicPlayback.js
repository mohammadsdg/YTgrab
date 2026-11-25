import { useEffect, useRef, useState } from 'react';

export default function useMusicPlayback({ api, active, onNotice, onPlayed }) {
  const [queue, setQueue] = useState([]);
  const [current, setCurrent] = useState(null);
  const [stream, setStream] = useState('');
  const [streamState, setStreamState] = useState('idle');
  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(false);
  playingRef.current = playing;
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(0);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState('off');
  const [rate, setRate] = useState(() => Number(localStorage.getItem('ytgrab_music_rate')) || 1);
  const [volume, setVolume] = useState(() => Number(localStorage.getItem('ytgrab_music_volume') ?? 0.85));
  const [muted, setMuted] = useState(false);
  const [sleep, setSleep] = useState(null);
  const [lyrics, setLyrics] = useState(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [lyricsOffsets, setLyricsOffsets] = useState(() => {
    try { return JSON.parse(localStorage.getItem('ytgrab_lyrics_offsets') || '{}'); }
    catch { return {}; }
  });
  const lyricsCache = useRef(new Map());
  const lyricRequestRef = useRef(0);
  const playHistoryRef = useRef([]);
  const shuffleSeenRef = useRef(new Set());
  const audioRef = useRef(null);
  const hlsRef = useRef(null);
  const requestRef = useRef(0);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.playbackRate = rate;
    localStorage.setItem('ytgrab_music_rate', String(rate));
  }, [rate, stream]);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.volume = Math.max(0, Math.min(1, volume));
    audioRef.current.muted = muted;
    localStorage.setItem('ytgrab_music_volume', String(volume));
  }, [volume, muted, stream]);

  useEffect(() => { localStorage.setItem('ytgrab_lyrics_offsets', JSON.stringify(lyricsOffsets)); }, [lyricsOffsets]);

  useEffect(() => {
    if (!Number.isFinite(sleep)) return undefined;
    const timer = setInterval(() => {
      if (Date.now() >= sleep) { audioRef.current?.pause(); setPlaying(false); setSleep(null); }
    }, 1000);
    return () => clearInterval(timer);
  }, [sleep]);

  const prepare = async (song) => {
    const request = ++requestRef.current;
    setStream(''); setPlaying(false); setStreamState('preparing');
    try {
      let state = await api(`/api/stream/${song.id}/prepare?quality=audio`, { method: 'POST' });
      while (!['done', 'error'].includes(state.status)) {
        await new Promise((resolve) => setTimeout(resolve, 900));
        if (requestRef.current !== request) return;
        state = await api(`/api/stream/${song.id}/status?quality=audio`);
      }
      if (requestRef.current !== request) return;
      if (state.status === 'error') throw new Error(state.error || 'Could not stream this song.');
      setStream(state.url);
      setStreamState('ready');
      setPlaying(true);
    } catch (error) {
      if (requestRef.current !== request) return;
      setStreamState('error');
      onNotice(error.message);
    }
  };

  const startTrack = (song) => {
    if (!song) return;
    setCurrent(song); setElapsed(0); setDuration(song.duration || 0);
    setLyrics(null); setLyricsLoading(false);
    ++lyricRequestRef.current;
    onPlayed(song);
    prepare(song);
  };

  const playSong = (song, source) => {
    if (current?.id === song.id && stream) { setPlaying((value) => !value); return; }
    setQueue(source?.length ? source : [song]);
    playHistoryRef.current = [];
    shuffleSeenRef.current.clear();
    startTrack(song);
  };

  const playCollection = (songs, randomize = false) => {
    if (!songs.length) return;
    const next = [...songs];
    if (randomize) {
      for (let index = next.length - 1; index > 0; index--) {
        const other = Math.floor(Math.random() * (index + 1));
        [next[index], next[other]] = [next[other], next[index]];
      }
    }
    setShuffle(randomize);
    setQueue(next);
    playHistoryRef.current = [];
    shuffleSeenRef.current.clear();
    startTrack(next[0]);
  };

  const toggleShuffle = () => { shuffleSeenRef.current.clear(); setShuffle((value) => !value); };
  const cycleRepeat = () => setRepeat((value) => value === 'off' ? 'all' : value === 'all' ? 'one' : 'off');

  const playQueue = (index) => {
    const song = queue[index];
    if (!song) return;
    if (current?.id === song.id && stream) { setPlaying(true); return; }
    if (current) playHistoryRef.current.push(current.id);
    startTrack(song);
  };

  const step = (direction, ended = false) => {
    if (!current || !queue.length) return;
    if (ended && sleep === 'track') { setSleep(null); setPlaying(false); return; }
    if (ended && repeat === 'one') { audioRef.current.currentTime = 0; audioRef.current.play().catch(() => setPlaying(false)); return; }
    if (direction < 0 && (audioRef.current?.currentTime || 0) > 3) { audioRef.current.currentTime = 0; return; }
    const at = Math.max(0, queue.findIndex((item) => item.id === current.id));
    let nextIndex;
    if (direction < 0 && playHistoryRef.current.length) {
      const previousId = playHistoryRef.current.pop();
      nextIndex = queue.findIndex((item) => item.id === previousId);
    } else if (direction > 0 && shuffle && queue.length > 1) {
      shuffleSeenRef.current.add(at);
      let candidates = queue.map((_song, index) => index).filter((index) => !shuffleSeenRef.current.has(index));
      if (!candidates.length) {
        if (ended && repeat === 'off') { setPlaying(false); return; }
        shuffleSeenRef.current.clear();
        shuffleSeenRef.current.add(at);
        candidates = queue.map((_song, index) => index).filter((index) => index !== at);
      }
      nextIndex = candidates[Math.floor(Math.random() * candidates.length)];
    } else {
      nextIndex = at + direction;
    }
    if (nextIndex < 0 || nextIndex >= queue.length) {
      if (ended && repeat === 'off') { setPlaying(false); return; }
      nextIndex = (nextIndex + queue.length) % queue.length;
    }
    if (direction > 0) playHistoryRef.current.push(current.id);
    startTrack(queue[nextIndex]);
  };

  const moveQueue = (from, to) => setQueue((items) => {
    if (from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
    const next = [...items];
    next.splice(to, 0, next.splice(from, 1)[0]);
    shuffleSeenRef.current.clear();
    return next;
  });

  const removeQueue = (index) => {
    const next = queue.filter((_item, at) => at !== index);
    shuffleSeenRef.current.clear();
    if (queue[index]?.id === current?.id) {
      if (next.length) startTrack(next[Math.min(index, next.length - 1)]);
      else { ++requestRef.current; audioRef.current?.pause(); setCurrent(null); setStream(''); setPlaying(false); }
    }
    setQueue(next);
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !stream) return undefined;
    let cancelled = false;
    const fail = (message) => { setPlaying(false); setStreamState('error'); onNotice(message); };
    const startWhenReady = () => {
      if (playingRef.current) audio.play().catch(() => setPlaying(false));
    };
    if (audio.canPlayType('application/vnd.apple.mpegurl')) {
      audio.src = stream;
      audio.addEventListener('canplay', startWhenReady);
      audio.load();
    } else {
      import('hls.js').then(({ default: Hls }) => {
        if (cancelled) return;
        if (!Hls.isSupported()) return fail('Audio playback is not supported here.');
        const hls = new Hls({ enableWorker: true, lowLatencyMode: false, startPosition: 0 });
        hlsRef.current = hls;
        hls.loadSource(stream);
        hls.attachMedia(audio);
        hls.on(Hls.Events.MANIFEST_PARSED, startWhenReady);
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
          else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
          else fail(`Audio playback failed: ${data.details}`);
        });
      }).catch((error) => fail(error.message));
    }
    return () => {
      cancelled = true;
      hlsRef.current?.destroy(); hlsRef.current = null;
      audio.removeEventListener('canplay', startWhenReady);
      audio.pause(); audio.removeAttribute('src'); audio.load();
    };
  }, [stream]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !stream) return;
    if (playing && audio.readyState >= 2) audio.play().catch(() => setPlaying(false));
    else audio.pause();
  }, [playing, stream]);

  const showLyrics = async () => {
    if (!current) return;
    const request = ++lyricRequestRef.current;
    if (lyricsCache.current.has(current.id)) { setLyrics(lyricsCache.current.get(current.id)); return; }
    setLyrics(null); setLyricsLoading(true);
    try {
      const params = new URLSearchParams({ title: current.title, artist: current.artist, duration: String(current.duration || '') });
      const data = await api(`/api/music/lyrics/${current.id}?${params}`);
      if (request !== lyricRequestRef.current) return;
      lyricsCache.current.set(current.id, data);
      setLyrics(data);
    } catch (error) { if (request === lyricRequestRef.current) setLyrics({ available: false, error: error.message }); }
    finally { if (request === lyricRequestRef.current) setLyricsLoading(false); }
  };

  const seek = (seconds) => {
    if (!audioRef.current || !Number.isFinite(seconds)) return;
    audioRef.current.currentTime = Math.max(0, Math.min(seconds, duration || seconds));
    setElapsed(audioRef.current.currentTime);
  };

  const closePlayer = () => {
    ++requestRef.current;
    ++lyricRequestRef.current;
    audioRef.current?.pause();
    setCurrent(null); setQueue([]); setStream(''); setPlaying(false); setSleep(null);
  };

  const setSleepTimer = (value) => setSleep(value === 'track' ? 'track' : value ? Date.now() + value * 60_000 : null);

  useEffect(() => {
    if (!current) return undefined;
    const handleKey = (event) => {
      if (!active && !document.querySelector('.now-playing')) return;
      if (event.altKey || event.ctrlKey || event.metaKey || (event.target instanceof Element && event.target.closest('button, input, textarea, select, [role="slider"], [contenteditable="true"], [role="dialog"]:not(.now-playing)'))) return;
      if (event.code === 'Space') { event.preventDefault(); setPlaying((value) => !value); }
      if (event.code === 'ArrowRight') seek((audioRef.current?.currentTime || 0) + 5);
      if (event.code === 'ArrowLeft') seek((audioRef.current?.currentTime || 0) - 5);
      if (event.code === 'KeyN') step(1);
      if (event.code === 'KeyP') step(-1);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [active, current, queue, shuffle, repeat, duration]);

  useEffect(() => {
    if (!current || !('mediaSession' in navigator) || !('MediaMetadata' in window)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.title, artist: current.artist, album: current.album || '',
      artwork: [{ src: new URL(current.thumbnail || `/api/thumbnail/${current.id}`, window.location.href).href }]
    });
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
    const handlers = {
      play: () => setPlaying(true), pause: () => setPlaying(false),
      nexttrack: () => step(1), previoustrack: () => step(-1),
      seekto: ({ seekTime }) => seek(seekTime)
    };
    for (const [action, handler] of Object.entries(handlers)) {
      try { navigator.mediaSession.setActionHandler(action, handler); }
      catch { /* this action is unavailable on the device */ }
    }
    return () => {
      for (const action of Object.keys(handlers)) {
        try { navigator.mediaSession.setActionHandler(action, null); }
        catch { /* ignore unsupported actions */ }
      }
    };
  }, [current, playing, queue, shuffle, repeat, duration]);

  useEffect(() => {
    if (!current || !('mediaSession' in navigator) || !Number.isFinite(duration) || duration <= 0) return;
    try { navigator.mediaSession.setPositionState?.({ duration, position: Math.min(elapsed, duration), playbackRate: rate }); }
    catch { /* not supported on every browser */ }
  }, [current, elapsed, duration, rate]);

  useEffect(() => {
    if (current || !('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.playbackState = 'none';
  }, [current]);

  return {
    queue, current, streamState, playing, setPlaying, elapsed, setElapsed,
    duration, setDuration, shuffle, repeat, rate, setRate,
    volume, setVolume, muted, setMuted, sleep, lyrics, lyricsLoading, lyricsOffsets,
    setLyricsOffsets, audioRef, prepare, playSong, playCollection, toggleShuffle, cycleRepeat,
    playQueue, step, moveQueue, removeQueue, showLyrics, seek, closePlayer,
    setSleepTimer
  };
}
