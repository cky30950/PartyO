import { useEffect, useRef, useState } from 'react';
import { Disc3, Music, Pause, Play, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react';
import type { PartySong } from '../types/party';

interface AudioYtPlayer {
  playVideo: () => void;
  pauseVideo: () => void;
  mute: () => void;
  unMute: () => void;
  isMuted: () => boolean;
  getCurrentTime?: () => number;
  getDuration?: () => number;
  seekTo?: (seconds: number, allowSeekAhead: boolean) => void;
  destroy: () => void;
}

let ytApiPromise: Promise<void> | null = null;

function ensureYouTubeApi(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.YT?.Player) return Promise.resolve();
  if (ytApiPromise) return ytApiPromise;

  ytApiPromise = new Promise<void>((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      tag.async = true;
      document.head.appendChild(tag);
    }
  });
  return ytApiPromise;
}

function formatSec(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '0:00';
  const total = Math.floor(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

interface PlaylistAudioPlayerProps {
  songs: PartySong[];
  activeSongId: string | null;
  autoPlayRequestId: number;
  onSelectSong: (songId: string) => void;
  onStartPlayback?: () => void;
}

export function PlaylistAudioPlayer({
  songs,
  activeSongId,
  autoPlayRequestId,
  onSelectSong,
  onStartPlayback,
}: PlaylistAudioPlayerProps) {
  const activeIndex = activeSongId ? songs.findIndex((s) => s.id === activeSongId) : 0;
  const safeIndex = activeIndex >= 0 ? activeIndex : 0;
  const currentSong = songs[safeIndex] ?? null;
  const videoId = currentSong?.trackId || '';

  const mountRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<AudioYtPlayer | null>(null);
  const songsRef = useRef(songs);
  const safeIndexRef = useRef(safeIndex);
  const onSelectSongRef = useRef(onSelectSong);
  songsRef.current = songs;
  safeIndexRef.current = safeIndex;
  onSelectSongRef.current = onSelectSong;

  const [ready, setReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const shouldAutoPlayRef = useRef(false);
  useEffect(() => {
    if (autoPlayRequestId > 0) {
      shouldAutoPlayRef.current = true;
    }
  }, [autoPlayRequestId]);

  useEffect(() => {
    if (!videoId) {
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {
          // ignore
        }
        playerRef.current = null;
      }
      setReady(false);
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);
      return;
    }

    let cancelled = false;
    setReady(false);
    setCurrentTime(0);
    setDuration(0);

    ensureYouTubeApi().then(() => {
      if (cancelled || !mountRef.current || !window.YT?.Player) return;

      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {
          // ignore
        }
        playerRef.current = null;
      }

      mountRef.current.innerHTML = '';
      const target = document.createElement('div');
      mountRef.current.appendChild(target);

      const player = new window.YT.Player(target, {
        width: '1',
        height: '1',
        videoId,
        playerVars: {
          autoplay: shouldAutoPlayRef.current ? 1 : 0,
          controls: 0,
          disablekb: 1,
          fs: 0,
          playsinline: 1,
          rel: 0,
        },
        events: {
          onReady: (ev) => {
            if (cancelled) return;
            setReady(true);
            const p = ev.target as unknown as AudioYtPlayer;
            if (p.getDuration) {
              const d = p.getDuration();
              if (d > 0) setDuration(d);
            }
            if (shouldAutoPlayRef.current) {
              try {
                p.unMute();
                p.playVideo();
              } catch {
                // ignore
              }
            }
          },
          onStateChange: (ev) => {
            if (cancelled) return;
            const p = ev.target as unknown as AudioYtPlayer;
            if (ev.data === 1) {
              setIsPlaying(true);
              setIsMuted(p.isMuted());
              if (p.getDuration) {
                const d = p.getDuration();
                if (d > 0) setDuration(d);
              }
            } else if (ev.data === 2) {
              setIsPlaying(false);
            } else if (ev.data === 0) {
              setIsPlaying(false);
              // 播完自動切下一首
              const list = songsRef.current;
              if (list.length > 1) {
                shouldAutoPlayRef.current = true;
                const nextIdx = (safeIndexRef.current + 1) % list.length;
                onSelectSongRef.current(list[nextIdx].id);
              }
            }
          },
        },
      }) as unknown as AudioYtPlayer;

      playerRef.current = player;
    });

    return () => {
      cancelled = true;
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {
          // ignore
        }
        playerRef.current = null;
      }
    };
  }, [videoId]);

  // 定時更新播放進度條
  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(() => {
      const p = playerRef.current;
      if (!p) return;
      try {
        if (p.getCurrentTime) setCurrentTime(p.getCurrentTime());
        if (p.getDuration) {
          const d = p.getDuration();
          if (d > 0) setDuration(d);
        }
      } catch {
        // ignore
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [isPlaying]);

  if (!currentSong) return null;

  function handleTogglePlay() {
    const p = playerRef.current;
    if (!p) return;
    try {
      if (isPlaying) {
        p.pauseVideo();
        setIsPlaying(false);
      } else {
        onStartPlayback?.();
        shouldAutoPlayRef.current = true;
        p.unMute();
        p.playVideo();
        setIsMuted(false);
      }
    } catch {
      // ignore
    }
  }

  function handleToggleMute() {
    const p = playerRef.current;
    if (!p) return;
    try {
      if (isMuted) {
        p.unMute();
        setIsMuted(false);
      } else {
        p.mute();
        setIsMuted(true);
      }
    } catch {
      // ignore
    }
  }

  function handlePrev() {
    if (songs.length === 0) return;
    onStartPlayback?.();
    shouldAutoPlayRef.current = true;
    const prevIdx = safeIndex > 0 ? safeIndex - 1 : songs.length - 1;
    onSelectSong(songs[prevIdx].id);
  }

  function handleNext() {
    if (songs.length === 0) return;
    onStartPlayback?.();
    shouldAutoPlayRef.current = true;
    const nextIdx = (safeIndex + 1) % songs.length;
    onSelectSong(songs[nextIdx].id);
  }

  function handleSeek(nextSec: number) {
    const p = playerRef.current;
    if (!p?.seekTo) return;
    try {
      p.seekTo(nextSec, true);
      setCurrentTime(nextSec);
    } catch {
      // ignore
    }
  }

  const progressPct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  return (
    <div className="mt-4 rounded-2xl bg-gradient-to-br from-rose-50/90 via-white to-amber-50/70 p-4 ring-1 ring-rose-200/80">
      {/* 隱藏的純音訊播放容器（不顯示 MV 畫面） */}
      <div
        ref={mountRef}
        aria-hidden="true"
        className="pointer-events-none fixed -left-[9999px] top-0 h-px w-px overflow-hidden opacity-0"
      />

      <div className="flex items-center gap-3">
        <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-2xl bg-slate-100 ring-1 ring-slate-200">
          {currentSong.albumImage ? (
            <img
              src={currentSong.albumImage}
              alt={currentSong.name}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-rose-500">
              <Music className="h-6 w-6" />
            </div>
          )}
          {isPlaying ? (
            <span className="absolute bottom-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose-600/90 text-white shadow">
              <Disc3 className="h-3 w-3 animate-spin" />
            </span>
          ) : null}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold tracking-wide text-rose-600">
            {isPlaying ? '正在播放音樂' : '聚會音樂播放器'} · 第 {safeIndex + 1} / {songs.length} 首
          </p>
          <p className="truncate text-sm font-bold text-slate-900">{currentSong.name}</p>
          <p className="truncate text-[11px] text-slate-500">
            {currentSong.artists} · 由 {currentSong.requestedByName} 點播
          </p>
        </div>
      </div>

      {/* 進度條 */}
      <div className="mt-3 flex items-center gap-2 text-[10px] font-medium text-slate-500">
        <span className="w-8 tabular-nums">{formatSec(currentTime)}</span>
        <input
          type="range"
          min={0}
          max={duration || 100}
          step={1}
          value={Math.min(currentTime, duration || 100)}
          disabled={!ready || duration <= 0}
          onChange={(e) => handleSeek(Number(e.target.value))}
          aria-label="播放進度"
          style={{
            background: `linear-gradient(to right, #e11d48 ${progressPct}%, #e2e8f0 ${progressPct}%)`,
          }}
          className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full accent-rose-600 disabled:cursor-default"
        />
        <span className="w-8 text-right tabular-nums">{formatSec(duration)}</span>
      </div>

      {/* 控制按鈕 */}
      <div className="mt-3 flex items-center justify-between">
        <button
          type="button"
          onClick={handleToggleMute}
          title={isMuted ? '取消靜音' : '靜音'}
          className="rounded-xl p-2 text-slate-500 transition hover:bg-white hover:text-slate-800"
        >
          {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </button>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handlePrev}
            disabled={songs.length <= 1}
            title="上一首"
            className="rounded-full bg-white p-2 text-slate-700 shadow-xs ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:opacity-40"
          >
            <SkipBack className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={handleTogglePlay}
            disabled={!ready}
            title={isPlaying ? '暫停' : '播放'}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-rose-600 text-white shadow-md transition hover:bg-rose-700 disabled:opacity-50"
          >
            {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}
          </button>

          <button
            type="button"
            onClick={handleNext}
            disabled={songs.length <= 1}
            title="下一首"
            className="rounded-full bg-white p-2 text-slate-700 shadow-xs ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:opacity-40"
          >
            <SkipForward className="h-4 w-4" />
          </button>
        </div>

        <span className="w-8" />
      </div>
    </div>
  );
}
