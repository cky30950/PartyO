import { useEffect, useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import {
  Check,
  Disc3,
  Music,
  Pause,
  Play,
  Search,
  Settings2,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type { Party, PartyThemeSong } from '../types/party';
import { searchYoutubeMusic, type YoutubeTrackResult } from '../lib/youtubeApi';

interface YtPlayerInstance {
  playVideo: () => void;
  pauseVideo: () => void;
  mute: () => void;
  unMute: () => void;
  isMuted: () => boolean;
  getPlayerState: () => number;
  loadVideoById: (videoId: string) => void;
  destroy: () => void;
}

declare global {
  interface Window {
    YT?: {
      Player: new (
        element: HTMLElement,
        options: {
          height?: string;
          width?: string;
          videoId: string;
          playerVars?: Record<string, string | number>;
          events?: {
            onReady?: (event: { target: YtPlayerInstance }) => void;
            onStateChange?: (event: { data: number; target: YtPlayerInstance }) => void;
            onError?: () => void;
          };
        }
      ) => YtPlayerInstance;
      PlayerState?: {
        PLAYING: number;
        PAUSED: number;
        ENDED: number;
      };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytApiPromise: Promise<void> | null = null;

function loadYouTubeIframeApi(): Promise<void> {
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

interface PartyThemeMusicPlayerProps {
  party: Party;
  isAdmin: boolean;
  mediaApiBase: string;
  pauseSignal: number;
  onUpdateParty: (updated: Party) => Promise<void>;
}

export function PartyThemeMusicPlayer({
  party,
  isAdmin,
  mediaApiBase,
  pauseSignal,
  onUpdateParty,
}: PartyThemeMusicPlayerProps) {
  const themeSong = party.themeSong;
  const videoId = themeSong?.videoId || '';

  const mountRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YtPlayerInstance | null>(null);
  const userPausedRef = useRef(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [needsGesture, setNeedsGesture] = useState(false);
  const [playerReady, setPlayerReady] = useState(false);

  // 管理員設定主題曲面板
  const [showPicker, setShowPicker] = useState(false);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<YoutubeTrackResult[]>([]);
  const [saving, setSaving] = useState(false);

  // 當點歌分頁開始播另一首歌時，自動暫停背景主題曲避免重疊
  useEffect(() => {
    if (pauseSignal <= 0) return;
    if (playerRef.current) {
      userPausedRef.current = true;
      try {
        playerRef.current.pauseVideo();
      } catch {
        // ignore
      }
      setIsPlaying(false);
    }
  }, [pauseSignal]);

  // 初始化或切換活動主題曲播放器
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
      setIsPlaying(false);
      setPlayerReady(false);
      setNeedsGesture(false);
      return;
    }

    let cancelled = false;
    userPausedRef.current = false;
    setPlayerReady(false);
    setNeedsGesture(false);

    loadYouTubeIframeApi().then(() => {
      if (cancelled || !mountRef.current || !window.YT?.Player) return;

      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {
          // ignore
        }
        playerRef.current = null;
      }

      // 每次重建一個乾淨的掛載點給 YouTube IFrame API
      mountRef.current.innerHTML = '';
      const targetEl = document.createElement('div');
      mountRef.current.appendChild(targetEl);

      const player = new window.YT.Player(targetEl, {
        width: '1',
        height: '1',
        videoId,
        playerVars: {
          autoplay: 1,
          controls: 0,
          disablekb: 1,
          fs: 0,
          loop: 1,
          playlist: videoId,
          playsinline: 1,
          rel: 0,
        },
        events: {
          onReady: (ev) => {
            if (cancelled) return;
            setPlayerReady(true);
            try {
              ev.target.unMute();
              ev.target.playVideo();
            } catch {
              // ignore
            }
            // 若瀏覽器擋住有聲自動播放，800ms 後偵測並啟用「點畫面任一處即開播」
            setTimeout(() => {
              if (cancelled || userPausedRef.current) return;
              try {
                const st = ev.target.getPlayerState();
                if (st !== 1) {
                  setNeedsGesture(true);
                }
              } catch {
                setNeedsGesture(true);
              }
            }, 900);
          },
          onStateChange: (ev) => {
            if (cancelled) return;
            if (ev.data === 1) {
              setIsPlaying(true);
              setNeedsGesture(false);
              setIsMuted(ev.target.isMuted());
            } else if (ev.data === 2) {
              setIsPlaying(false);
            } else if (ev.data === 0) {
              // 結束時循環播放
              if (!userPausedRef.current) {
                try {
                  ev.target.playVideo();
                } catch {
                  // ignore
                }
              }
            }
          },
          onError: () => {
            if (!cancelled) {
              setIsPlaying(false);
              setNeedsGesture(false);
            }
          },
        },
      });

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

  // 當瀏覽器因無手勢而阻擋自動播放時，監聽用戶第一次點擊／觸控頁面即自動解鎖播放
  useEffect(() => {
    if (!needsGesture || !videoId) return;
    const unlock = () => {
      if (userPausedRef.current || !playerRef.current) return;
      try {
        playerRef.current.unMute();
        playerRef.current.playVideo();
        setIsMuted(false);
        setNeedsGesture(false);
      } catch {
        // ignore
      }
    };
    window.addEventListener('pointerdown', unlock, { once: true, passive: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [needsGesture, videoId]);

  function handleTogglePlay() {
    const player = playerRef.current;
    if (!player) return;
    try {
      if (isPlaying) {
        userPausedRef.current = true;
        player.pauseVideo();
        setIsPlaying(false);
      } else {
        userPausedRef.current = false;
        player.unMute();
        player.playVideo();
        setIsMuted(false);
        setNeedsGesture(false);
      }
    } catch {
      // ignore
    }
  }

  function handleToggleMute() {
    const player = playerRef.current;
    if (!player) return;
    try {
      if (isMuted) {
        player.unMute();
        setIsMuted(false);
      } else {
        player.mute();
        setIsMuted(true);
      }
    } catch {
      // ignore
    }
  }

  async function handleSearchTheme(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    try {
      const tracks = await searchYoutubeMusic(mediaApiBase, q);
      setResults(tracks);
      if (tracks.length === 0) {
        toast.info('找不到相符歌曲，可換個關鍵字或直接貼上 YouTube / YouTube Music 連結');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '搜尋失敗');
    } finally {
      setSearching(false);
    }
  }

  async function handleSelectThemeSong(track: YoutubeTrackResult) {
    if (!isAdmin) return;
    setSaving(true);
    try {
      const nextThemeSong: PartyThemeSong = {
        videoId: track.id,
        title: track.title,
        artists: track.artists,
        thumbnail: track.thumbnail,
        url: track.musicUrl,
      };
      await onUpdateParty({
        ...party,
        themeSong: nextThemeSong,
      });
      setShowPicker(false);
      setQuery('');
      setResults([]);
      toast.success(`已設定活動主題曲「${track.title}」`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '儲存主題曲失敗');
    } finally {
      setSaving(false);
    }
  }

  async function handleClearThemeSong() {
    if (!isAdmin) return;
    setSaving(true);
    try {
      const nextParty = { ...party };
      delete nextParty.themeSong;
      await onUpdateParty(nextParty);
      setShowPicker(false);
      toast.success('已清除活動主題曲');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '清除失敗');
    } finally {
      setSaving(false);
    }
  }

  if (!themeSong && !isAdmin) {
    return null;
  }

  return (
    <>
      {/* 隱藏的 YouTube 背景音樂播放容器（跨分頁持續播放） */}
      <div
        ref={mountRef}
        aria-hidden="true"
        className="pointer-events-none fixed -left-[9999px] top-0 h-px w-px overflow-hidden opacity-0"
      />

      {/* 右下角浮動迷你主題曲控制列 */}
      <div className="fixed bottom-4 right-4 z-30 flex max-w-[calc(100vw-2rem)] items-center gap-1.5">
        {themeSong ? (
          <div className="flex items-center gap-2 rounded-full border-2 border-[#4A2E1B] bg-[#FFF9EB]/95 py-1.5 pl-2 pr-2.5 shadow-lg backdrop-blur">
            <button
              type="button"
              onClick={handleTogglePlay}
              disabled={!playerReady}
              title={isPlaying ? '暫停主題曲' : '播放主題曲'}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white transition disabled:opacity-50 ${
                needsGesture
                  ? 'animate-pulse bg-rose-600 hover:bg-rose-700'
                  : isPlaying
                  ? 'bg-emerald-600 hover:bg-emerald-700'
                  : 'bg-brand-600 hover:bg-brand-700'
              }`}
            >
              {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="ml-0.5 h-3.5 w-3.5" />}
            </button>

            <button
              type="button"
              onClick={handleTogglePlay}
              className="min-w-0 max-w-[140px] text-left sm:max-w-[190px]"
            >
              <p className="flex items-center gap-1 text-[10px] font-bold text-rose-600">
                <Disc3 className={`h-3 w-3 shrink-0 ${isPlaying ? 'animate-spin' : ''}`} />
                {needsGesture ? '點一下播放主題曲' : isPlaying ? '主題曲播放中' : '活動主題曲'}
              </p>
              <p className="truncate text-xs font-bold text-slate-900">{themeSong.title}</p>
            </button>

            <button
              type="button"
              onClick={handleToggleMute}
              title={isMuted ? '取消靜音' : '靜音'}
              className="rounded-full p-1.5 text-slate-500 hover:bg-slate-200/70 hover:text-slate-800"
            >
              {isMuted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
            </button>

            {isAdmin ? (
              <button
                type="button"
                onClick={() => setShowPicker(true)}
                title="更換活動主題曲"
                className="rounded-full p-1.5 text-slate-500 hover:bg-slate-200/70 hover:text-brand-700"
              >
                <Settings2 className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        ) : isAdmin ? (
          <button
            type="button"
            onClick={() => setShowPicker(true)}
            className="inline-flex items-center gap-1.5 rounded-full border-2 border-[#4A2E1B] bg-[#FFF9EB]/95 px-3.5 py-2 text-xs font-bold text-slate-800 shadow-lg transition hover:bg-amber-50"
          >
            <Music className="h-3.5 w-3.5 text-rose-600" />
            設定活動主題曲
          </button>
        ) : null}
      </div>

      {/* 管理員選擇活動主題曲彈窗 */}
      {isAdmin && showPicker ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-3 backdrop-blur-xs sm:items-center">
          <div className="w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl ring-1 ring-slate-200">
            <div className="flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
                <Music className="h-4 w-4 text-rose-600" />
                設定此活動專屬主題曲
              </h3>
              <button
                type="button"
                onClick={() => setShowPicker(false)}
                className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              參加者進入這個活動頁面時會自動播放此主題曲（可在右下角隨時暫停或靜音）。
            </p>

            {themeSong ? (
              <div className="mt-3 flex items-center justify-between gap-2 rounded-2xl bg-rose-50/70 px-3 py-2.5 ring-1 ring-rose-200">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold text-rose-700">目前主題曲</p>
                  <p className="truncate text-xs font-bold text-slate-900">{themeSong.title}</p>
                </div>
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleClearThemeSong}
                  className="inline-flex shrink-0 items-center gap-1 rounded-xl bg-white px-2.5 py-1.5 text-[11px] font-semibold text-rose-600 ring-1 ring-rose-200 hover:bg-rose-50"
                >
                  <Trash2 className="h-3 w-3" /> 移除
                </button>
              </div>
            ) : null}

            <form onSubmit={handleSearchTheme} className="mt-3 flex gap-2">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="輸入歌名／歌手或貼上 YouTube 連結"
                className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-xs outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-100"
              />
              <button
                type="submit"
                disabled={searching || !query.trim()}
                className="inline-flex shrink-0 items-center gap-1 rounded-xl bg-rose-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
              >
                <Search className="h-3.5 w-3.5" />
                {searching ? '搜尋中' : '搜尋'}
              </button>
            </form>

            {results.length > 0 ? (
              <div className="mt-3 max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-2xl bg-slate-50 px-2.5 ring-1 ring-slate-200/80">
                {results.map((track) => {
                  const isCurrent = themeSong?.videoId === track.id;
                  return (
                    <div key={track.id} className="flex items-center justify-between gap-2.5 py-2">
                      <div className="flex min-w-0 items-center gap-2">
                        {track.thumbnail ? (
                          <img
                            src={track.thumbnail}
                            alt={track.title}
                            className="h-9 w-12 shrink-0 rounded-lg object-cover"
                          />
                        ) : null}
                        <div className="min-w-0">
                          <p className="truncate text-xs font-bold text-slate-900">{track.title}</p>
                          <p className="truncate text-[10px] text-slate-500">{track.artists}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={saving || isCurrent}
                        onClick={() => handleSelectThemeSong(track)}
                        className={`inline-flex shrink-0 items-center gap-1 rounded-xl px-2.5 py-1.5 text-[11px] font-semibold transition ${
                          isCurrent
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50'
                        }`}
                      >
                        {isCurrent ? (
                          <>
                            <Check className="h-3 w-3" /> 使用中
                          </>
                        ) : (
                          '設為主題曲'
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
