import { useEffect, useRef, useState } from 'react';
import { api, videoIdFromInput } from '../utils';

export default function useVideoSearch(onNotice) {
  const [query, setQuery] = useState('');
  const videoSearchRef = useRef(0);
  const videoSearchAbortRef = useRef(null);
  const [results, setResults] = useState([]);
  const [searchPage, setSearchPage] = useState(1);
  const [searchHasMore, setSearchHasMore] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => () => videoSearchAbortRef.current?.abort(), []);

  const search = async () => {
    const value = query.trim();
    if (!value) return;
    const request = ++videoSearchRef.current;
    videoSearchAbortRef.current?.abort();
    const controller = new AbortController();
    videoSearchAbortRef.current = controller;
    const directId = videoIdFromInput(value);
    if (directId) {
      const direct = { id: directId, title: 'YouTube video', channel: '', channelId: '', thumbnail: `/api/thumbnail/${directId}` };
      setResults([direct]); setSearchPage(1); setSearchHasMore(false);
      setBusy(false);
      return;
    }
    setBusy(true);
    try {
      const data = await api(`/api/search?q=${encodeURIComponent(value)}&page=1`, { signal: controller.signal });
      if (request !== videoSearchRef.current) return;
      setResults(data.results); setSearchPage(1); setSearchHasMore(data.hasMore);
    }
    catch (err) { if (request === videoSearchRef.current && err.name !== 'AbortError') onNotice(err.message); }
    finally { if (request === videoSearchRef.current) setBusy(false); }
  };

  return { query, setQuery, results, setResults, searchPage, setSearchPage, searchHasMore, setSearchHasMore, busy, search };
}
