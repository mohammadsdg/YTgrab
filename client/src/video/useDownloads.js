import { useState } from 'react';
import { api } from '../utils';

export default function useDownloads(setFiles) {
  const [downloadJobs, setDownloadJobs] = useState([]);

  const updateDownloadJob = (key, patch) => {
    setDownloadJobs((current) => current.map((job) => job.key === key ? { ...job, ...patch } : job));
  };

  const pollDownload = (key, id) => {
    const check = async () => {
      try {
        const state = await api(`/api/status/${id}`);
        updateDownloadJob(key, state);
        if (!['done', 'error'].includes(state.status)) setTimeout(check, 1200);
        if (state.status === 'done') api('/api/files').then((data) => setFiles(data.files)).catch(() => {});
      } catch (error) {
        updateDownloadJob(key, { status: 'error', error: error.message });
      }
    };
    setTimeout(check, 700);
  };

  const startDownload = async (video, quality = '720') => {
    const key = `${video.id}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setDownloadJobs((current) => [...current, { key, video, quality, status: 'starting', progress: 0 }]);
    try {
      const started = await api('/api/download', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: `https://www.youtube.com/watch?v=${video.id}`, quality, video }) });
      updateDownloadJob(key, { id: started.id, status: 'processing' });
      pollDownload(key, started.id);
    } catch (error) { updateDownloadJob(key, { status: 'error', error: error.message }); }
  };

  return { downloadJobs, setDownloadJobs, startDownload };
}
