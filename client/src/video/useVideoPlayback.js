import { useEffect, useRef, useState } from 'react';
import { api } from '../utils';

export default function useVideoPlayback(onWatched) {
  const [player, setPlayer] = useState(null);
  const [playerStatus, setPlayerStatus] = useState(null);
  const [playerQuality, setPlayerQuality] = useState('720');
  const playerRequestRef = useRef(0);
  const playerAbortRef = useRef(null);
  const playerTimeoutRef = useRef(null);

  useEffect(() => () => {
    playerAbortRef.current?.abort();
    clearTimeout(playerTimeoutRef.current);
  }, []);

  const pollStream = (videoId, quality, requestId, deadline) => {
    const check = async () => {
      if (playerRequestRef.current !== requestId) return;
      if (Date.now() > deadline) { clearTimeout(playerTimeoutRef.current); setPlayerStatus({ id: videoId, status: 'error', error: 'Video preparation took too long. Try again.' }); return; }
      try {
        const state = await api(`/api/stream/${videoId}/status?quality=${quality}`, { signal: playerAbortRef.current?.signal });
        if (playerRequestRef.current !== requestId) return;
        setPlayerStatus({ id: videoId, ...state });
        if (!['done', 'error'].includes(state.status)) setTimeout(check, 1500);
        else clearTimeout(playerTimeoutRef.current);
      } catch (error) {
        if (playerRequestRef.current !== requestId) return;
        clearTimeout(playerTimeoutRef.current);
        setPlayerStatus({ id: videoId, status: 'error', error: error.name === 'AbortError' ? 'Video preparation took too long. Try again.' : error.message });
      }
    };
    setTimeout(check, 800);
  };

  const preparePlayback = async (video, quality) => {
    const requestId = ++playerRequestRef.current;
    playerAbortRef.current?.abort();
    clearTimeout(playerTimeoutRef.current);
    const controller = new AbortController();
    playerAbortRef.current = controller;
    const deadline = Date.now() + 90_000;
    playerTimeoutRef.current = setTimeout(() => controller.abort(), 90_000);
    setPlayerStatus({ id: video.id, status: 'starting', progress: 0 });
    try {
      const state = await api(`/api/stream/${video.id}/prepare?quality=${quality}`, { method: 'POST', signal: controller.signal });
      if (playerRequestRef.current !== requestId) return;
      setPlayerStatus({ id: video.id, ...state });
      if (!['done', 'error'].includes(state.status)) pollStream(video.id, quality, requestId, deadline);
      else clearTimeout(playerTimeoutRef.current);
    } catch (error) {
      if (playerRequestRef.current !== requestId) return;
      clearTimeout(playerTimeoutRef.current);
      setPlayerStatus({ id: video.id, status: 'error', error: error.name === 'AbortError' ? 'Video preparation took too long. Try again.' : error.message });
    }
  };

  const play = async (video) => {
    setPlayer(video);
    setPlayerQuality('720');
    onWatched(video);
    preparePlayback(video, '720');
  };

  const closePlayer = () => {
    ++playerRequestRef.current;
    playerAbortRef.current?.abort();
    clearTimeout(playerTimeoutRef.current);
    setPlayer(null);
    setPlayerStatus(null);
  };

  return { player, playerStatus, playerQuality, setPlayerQuality, preparePlayback, play, closePlayer };
}
