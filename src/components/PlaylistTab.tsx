import { useEffect, useState, type FormEvent } from 'react';
import type { User } from 'firebase/auth';
import { toast } from 'sonner';
import {
  Check,
  Copy,
  Disc3,
  ExternalLink,
  Link2,
  LogIn,
  Music,
  Play,
  Plus,
  Search,
  SkipBack,
  SkipForward,
  Sparkles,
  Trash2,
  Unlink,
} from 'lucide-react';
import type { Party, PartySong } from '../types/party';
import {
  createPartyYoutubePlaylist,
  deletePartySong,
  disconnectHostYoutube,
  extractYoutubePlaylistId,
  fetchYoutubeStatus,
  requestPartySong,
  requestYoutubeAuthUrl,
  searchYoutubeMusic,
  subscribePartySongs,
  type YoutubeStatus,
  type YoutubeTrackResult,
} from '../lib/youtubeApi';

interface PlaylistTabProps {
  party: Party;
  isAdmin: boolean;
  currentUser: User | null;
  authBusy: boolean;
  mediaApiBase: string;
  onSignIn: () => Promise<void>;
  onUpdateParty: (updated: Party) => Promise<void>;
  onStartPlayingTrack?: () => void;
}

export function PlaylistTab({
  party,
  isAdmin,
  currentUser,
  authBusy,
  mediaApiBase,
  onSignIn,
  onUpdateParty,
  onStartPlayingTrack,
}: PlaylistTabProps) {
  const [songs, setSongs] = useState<PartySong[]>([]);
  const [status, setStatus] = useState<YoutubeStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);

  const [manualPlaylistInput, setManualPlaylistInput] = useState('');
  const [showManualLink, setShowManualLink] = useState(false);
  const [copiedRedirect, setCopiedRedirect] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<YoutubeTrackResult[]>([]);
  const [addingTrackId, setAddingTrackId] = useState<string | null>(null);
  const [deletingSongId, setDeletingSongId] = useState<string | null>(null);
  const [playingSongId, setPlayingSongId] = useState<string | null>(null);

  useEffect(() => {
    return subscribePartySongs(party.id, setSongs);
  }, [party.id]);

  useEffect(() => {
    let cancelled = false;
    setLoadingStatus(true);
    fetchYoutubeStatus(mediaApiBase)
      .then((res) => {
        if (!cancelled) setStatus(res);
      })
      .catch(() => {
        if (!cancelled) setStatus(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingStatus(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mediaApiBase]);

  // 從 YouTube OAuth 回調回來時顯示提示並清掉網址參數
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const yt = params.get('yt');
    if (!yt) return;
    if (yt === 'connected') {
      toast.success('已成功連結主辦人 YouTube Music 帳號！');
      fetchYoutubeStatus(mediaApiBase).then(setStatus).catch(() => {});
    } else if (yt === 'error') {
      toast.error('YouTube Music 授權失敗，請檢查 Redirect URI 與測試使用者設定');
    }
    params.delete('yt');
    const nextUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
    window.history.replaceState({}, '', nextUrl);
  }, [mediaApiBase]);

  const hasLinkedPlaylist = Boolean(party.youtubePlaylistId);
  const canSyncToYoutube = Boolean(status?.connected && party.youtubePlaylistId);

  async function handleConnectYoutube() {
    if (!currentUser || !isAdmin) return;
    setConnecting(true);
    try {
      const { authUrl } = await requestYoutubeAuthUrl(
        mediaApiBase,
        currentUser,
        window.location.href
      );
      window.location.href = authUrl;
    } catch (err) {
      const msg = err instanceof Error ? err.message : '無法啟動 YouTube Music 授權';
      toast.error(msg);
      setConnecting(false);
    }
  }

  async function handleDisconnectYoutube() {
    if (!currentUser || !isAdmin) return;
    const ok = window.confirm('確定要解除主辦人 YouTube Music 帳號連結嗎？');
    if (!ok) return;
    try {
      await disconnectHostYoutube(mediaApiBase, currentUser);
      const next = await fetchYoutubeStatus(mediaApiBase);
      setStatus(next);
      toast.success('已解除 YouTube Music 帳號連結');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '解除失敗');
    }
  }

  async function handleCreatePlaylist() {
    if (!currentUser || !isAdmin) return;
    setCreatingPlaylist(true);
    try {
      const created = await createPartyYoutubePlaylist({
        apiBase: mediaApiBase,
        user: currentUser,
        name: `🎉 ${party.title}`,
        description: `由 PartyO 參加者共同點歌建立的聚會歌單（搞手：${party.hostName}）`,
      });
      await onUpdateParty({
        ...party,
        youtubePlaylistId: created.playlistId,
        youtubePlaylistUrl: created.playlistUrl,
        youtubePlaylistName: created.name,
      });
      toast.success(`已建立並綁定 YouTube Music 歌單「${created.name}」`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '建立歌單失敗');
    } finally {
      setCreatingPlaylist(false);
    }
  }

  async function handleBindManualPlaylist(e: FormEvent) {
    e.preventDefault();
    if (!isAdmin) return;
    const id = extractYoutubePlaylistId(manualPlaylistInput);
    if (!id) {
      toast.error('請貼上有效的 YouTube / YouTube Music 歌單網址（含 list= 參數）');
      return;
    }
    await onUpdateParty({
      ...party,
      youtubePlaylistId: id,
      youtubePlaylistUrl: `https://music.youtube.com/playlist?list=${id}`,
      youtubePlaylistName: party.youtubePlaylistName || `${party.title} 聚會歌單`,
    });
    setManualPlaylistInput('');
    setShowManualLink(false);
    toast.success('已綁定 YouTube Music 歌單');
  }

  async function handleUnbindPlaylist() {
    if (!isAdmin) return;
    await onUpdateParty({
      ...party,
      youtubePlaylistId: '',
      youtubePlaylistUrl: '',
      youtubePlaylistName: '',
    });
    toast.success('已解除此活動的 YouTube Music 歌單綁定');
  }

  async function handleSearch(e: FormEvent) {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;
    setSearching(true);
    try {
      const results = await searchYoutubeMusic(mediaApiBase, q);
      setSearchResults(results);
      if (results.length === 0) {
        toast.info('找不到相符的歌曲，換個關鍵字或直接貼上 YouTube 連結試試');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '搜尋失敗');
    } finally {
      setSearching(false);
    }
  }

  async function handleAddTrack(track: YoutubeTrackResult) {
    if (!currentUser) {
      toast.error('請先登入 Google 帳號即可點歌');
      return;
    }
    if (songs.some((s) => s.trackId === track.id)) {
      toast.info(`「${track.title}」已經在點歌單裡了`);
      return;
    }
    const requesterName =
      party.rsvps?.[currentUser.uid]?.name ||
      currentUser.displayName ||
      currentUser.email?.split('@')[0] ||
      '參加者';

    setAddingTrackId(track.id);
    try {
      await requestPartySong({
        apiBase: mediaApiBase,
        partyId: party.id,
        playlistId: canSyncToYoutube ? party.youtubePlaylistId : undefined,
        track,
        user: currentUser,
        requesterName,
      });
      toast.success(
        canSyncToYoutube
          ? `已點歌「${track.title}」並即時加入 YouTube Music 歌單！`
          : `已加入派對點歌單「${track.title}」`
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '點歌失敗');
    } finally {
      setAddingTrackId(null);
    }
  }

  async function handleRemoveSong(song: PartySong) {
    if (!currentUser) return;
    const canDelete = isAdmin || song.requestedByUid === currentUser.uid;
    if (!canDelete) return;
    setDeletingSongId(song.id);
    try {
      await deletePartySong({
        apiBase: mediaApiBase,
        song,
        user: currentUser,
      });
      toast.success(`已移除「${song.name}」`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '移除失敗');
    } finally {
      setDeletingSongId(null);
    }
  }

  async function handleSetThemeSong(params: {
    videoId: string;
    title: string;
    artists?: string;
    thumbnail?: string;
    url?: string;
  }) {
    if (!isAdmin) return;
    try {
      await onUpdateParty({
        ...party,
        themeSong: {
          videoId: params.videoId,
          title: params.title,
          artists: params.artists || '',
          thumbnail: params.thumbnail || '',
          url: params.url || `https://music.youtube.com/watch?v=${params.videoId}`,
        },
      });
      toast.success(`已將「${params.title}」設為此活動主題曲`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '設定主題曲失敗');
    }
  }

  return (
    <div className="space-y-5">
      {/* 頂部：YouTube Music 聚會共同點歌單與主辦人設定 */}
      <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
              <Music className="h-4 w-4 text-rose-600" />
              YouTube Music 聚會共同點歌單
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              參加者無需 YouTube Music Premium，直接搜歌或貼上連結即可即時加入主辦人的派對歌單。
            </p>
          </div>
          {party.youtubePlaylistUrl ? (
            <a
              href={party.youtubePlaylistUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-xl bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rose-700"
            >
              <Play className="h-3.5 w-3.5" /> 在 YouTube Music 開啟
            </a>
          ) : null}
        </div>

        {/* 主辦人 YouTube Music 授權與歌單管理 */}
        {isAdmin ? (
          <div className="mt-3.5 space-y-2.5 rounded-2xl bg-slate-50 p-3.5 ring-1 ring-slate-200/80">
            {loadingStatus ? (
              <p className="text-xs text-slate-400">檢查 YouTube Music 連線狀態中...</p>
            ) : !status?.configured ? (
              <div className="space-y-2 text-xs text-slate-600">
                <p className="font-bold text-slate-800">尚未設定 YouTube OAuth 憑證</p>
                <p className="text-[11px] leading-relaxed">
                  在 Google Cloud Console（專案 <code className="rounded bg-slate-200 px-1">cheungec-ea477</code>）啟用{' '}
                  <strong>YouTube Data API v3</strong>，建立「網頁應用程式」OAuth 用戶端並填入以下重新導向 URI，再把{' '}
                  <code className="rounded bg-slate-200 px-1">YOUTUBE_CLIENT_ID</code> 與{' '}
                  <code className="rounded bg-slate-200 px-1">YOUTUBE_CLIENT_SECRET</code> 設為 Worker <strong>Secret</strong>：
                </p>
                {status?.redirectUri ? (
                  <div className="flex items-center gap-2">
                    <code className="flex-1 truncate rounded-xl bg-white px-2.5 py-1.5 text-[11px] ring-1 ring-slate-200">
                      {status.redirectUri}
                    </code>
                    <button
                      type="button"
                      onClick={async () => {
                        await navigator.clipboard.writeText(status.redirectUri);
                        setCopiedRedirect(true);
                        toast.success('已複製重新導向 URI');
                        setTimeout(() => setCopiedRedirect(false), 2000);
                      }}
                      className="inline-flex shrink-0 items-center gap-1 rounded-xl bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100"
                    >
                      {copiedRedirect ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                      複製
                    </button>
                  </div>
                ) : null}
              </div>
            ) : !status.connected ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-bold text-slate-800">步驟 1：連結主辦人 YouTube Music 帳號</p>
                  <p className="text-[11px] text-slate-500">
                    授權一次後，參加者點歌會自動寫入你的 YouTube Music 歌單，現場可用 Premium 無廣告播放。
                  </p>
                </div>
                <button
                  type="button"
                  disabled={connecting}
                  onClick={handleConnectYoutube}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-rose-700 disabled:opacity-60"
                >
                  <Disc3 className="h-4 w-4" />
                  {connecting ? '跳轉授權中...' : '連結我的 YouTube Music'}
                </button>
              </div>
            ) : (
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800">
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                    已連結 YouTube Music：{status.channelTitle || status.channelId}
                  </span>
                  <button
                    type="button"
                    onClick={handleDisconnectYoutube}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-slate-200/70 hover:text-rose-600"
                  >
                    <Unlink className="h-3 w-3" /> 解除連結
                  </button>
                </div>

                {!hasLinkedPlaylist ? (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={creatingPlaylist}
                      onClick={handleCreatePlaylist}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-rose-700 disabled:opacity-60"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      {creatingPlaylist ? '建立中...' : '一鍵建立此活動專屬 YouTube Music 歌單'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowManualLink((v) => !v)}
                      className="inline-flex items-center gap-1 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100"
                    >
                      <Link2 className="h-3.5 w-3.5" /> 綁定現有歌單
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white px-3 py-2 text-xs ring-1 ring-rose-200">
                    <span className="truncate font-semibold text-slate-800">
                      已綁定歌單：{party.youtubePlaylistName || party.youtubePlaylistId}
                    </span>
                    <button
                      type="button"
                      onClick={handleUnbindPlaylist}
                      className="text-[11px] font-medium text-slate-400 hover:text-rose-600 hover:underline"
                    >
                      更換／解除綁定
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* 即使尚未設定 OAuth，主辦人也可先手動貼上現有歌單網址嵌入播放 */}
            {!status?.connected && !hasLinkedPlaylist ? (
              <div className="border-t border-slate-200/70 pt-2">
                <button
                  type="button"
                  onClick={() => setShowManualLink((v) => !v)}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 hover:text-rose-700"
                >
                  <Link2 className="h-3.5 w-3.5" />
                  {showManualLink ? '收起手動貼上歌單' : '或先貼上現有 YouTube / YouTube Music 歌單連結嵌入播放'}
                </button>
              </div>
            ) : null}

            {showManualLink ? (
              <form onSubmit={handleBindManualPlaylist} className="flex flex-col gap-2 pt-1 sm:flex-row">
                <input
                  type="text"
                  value={manualPlaylistInput}
                  onChange={(e) => setManualPlaylistInput(e.target.value)}
                  placeholder="貼上歌單網址（music.youtube.com/playlist?list=...）"
                  className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-rose-500"
                />
                <button
                  type="submit"
                  className="rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                >
                  綁定歌單
                </button>
              </form>
            ) : null}
          </div>
        ) : null}

        {/* 內嵌官方 YouTube 播放器（支援整張歌單或點擊任一首單曲即點即播） */}
        {(() => {
          const activeIndex = playingSongId ? songs.findIndex((s) => s.id === playingSongId) : -1;
          const activeSong = activeIndex >= 0 ? songs[activeIndex] : null;
          const hasPlayer = Boolean(activeSong || party.youtubePlaylistId || songs.length > 0);
          if (!hasPlayer) return null;

          let embedSrc = '';
          if (activeSong) {
            const queueIds = songs
              .map((s) => s.trackId)
              .filter((id) => id && id !== activeSong.trackId);
            const qs = new URLSearchParams({ autoplay: '1', rel: '0' });
            if (queueIds.length > 0) qs.set('playlist', queueIds.join(','));
            embedSrc = `https://www.youtube.com/embed/${encodeURIComponent(activeSong.trackId)}?${qs.toString()}`;
          } else if (party.youtubePlaylistId) {
            embedSrc = `https://www.youtube.com/embed/videoseries?list=${encodeURIComponent(party.youtubePlaylistId)}`;
          } else if (songs.length > 0) {
            const first = songs[0];
            const queueIds = songs.slice(1).map((s) => s.trackId).filter(Boolean);
            const qs = new URLSearchParams({ rel: '0' });
            if (queueIds.length > 0) qs.set('playlist', queueIds.join(','));
            embedSrc = `https://www.youtube.com/embed/${encodeURIComponent(first.trackId)}?${qs.toString()}`;
          }

          const handlePrev = () => {
            if (songs.length === 0) return;
            const nextIdx = activeIndex > 0 ? activeIndex - 1 : songs.length - 1;
            onStartPlayingTrack?.();
            setPlayingSongId(songs[nextIdx].id);
          };
          const handleNext = () => {
            if (songs.length === 0) return;
            const nextIdx = activeIndex >= 0 && activeIndex < songs.length - 1 ? activeIndex + 1 : 0;
            onStartPlayingTrack?.();
            setPlayingSongId(songs[nextIdx].id);
          };

          return (
            <div className="mt-4 space-y-2">
              <div className="overflow-hidden rounded-2xl bg-black ring-1 ring-slate-200/80">
                <iframe
                  key={embedSrc}
                  title="YouTube Music 聚會歌單播放器"
                  src={embedSrc}
                  width="100%"
                  height="240"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  className="block w-full border-0"
                />
              </div>
              {songs.length > 0 ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-1.5 text-[11px] text-slate-600 ring-1 ring-slate-200/70">
                  <span className="truncate font-medium">
                    {activeSong
                      ? `正在播放：${activeSong.name}`
                      : party.youtubePlaylistId
                      ? `歌單模式：${party.youtubePlaylistName || '聚會歌單'}`
                      : `點歌單首曲：${songs[0].name}`}
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={handlePrev}
                      title="上一首"
                      className="inline-flex items-center gap-0.5 rounded-lg bg-white px-2 py-1 font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100"
                    >
                      <SkipBack className="h-3 w-3" /> 上一首
                    </button>
                    <button
                      type="button"
                      onClick={handleNext}
                      title="下一首"
                      className="inline-flex items-center gap-0.5 rounded-lg bg-white px-2 py-1 font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100"
                    >
                      下一首 <SkipForward className="h-3 w-3" />
                    </button>
                    {activeSong && party.youtubePlaylistId ? (
                      <button
                        type="button"
                        onClick={() => setPlayingSongId(null)}
                        className="rounded-lg px-2 py-1 font-semibold text-rose-600 hover:bg-rose-50"
                      >
                        回歌單
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })()}
      </section>

      {/* 搜尋歌曲或貼上連結點歌 */}
      <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
        <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
          <Search className="h-4 w-4 text-brand-600" />
          搜尋歌曲或貼上 YouTube 連結點歌
        </h3>

        {!currentUser ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-slate-50 px-4 py-3 text-xs text-slate-600 ring-1 ring-slate-200/70">
            <span>登入 Google 帳號即可搜尋並點歌，會自動記錄點歌人名字。</span>
            <button
              type="button"
              disabled={authBusy}
              onClick={onSignIn}
              className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              <LogIn className="h-3.5 w-3.5" /> Google 登入點歌
            </button>
          </div>
        ) : (
          <>
            <form onSubmit={handleSearch} className="mt-3 flex gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={
                  status?.connected
                    ? '輸入歌名、歌手（例如：陳奕迅、MC 張天賦）或貼上 YouTube 連結'
                    : '直接貼上 YouTube / YouTube Music 歌曲連結即可點歌'
                }
                className="flex-1 rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-100"
              />
              <button
                type="submit"
                disabled={searching || !searchQuery.trim()}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-rose-700 disabled:opacity-50"
              >
                <Search className="h-4 w-4" />
                {searching ? '搜尋中...' : '搜尋'}
              </button>
            </form>

            {!status?.connected ? (
              <p className="mt-2 text-[11px] text-slate-400">
                提示：主辦人尚未連結 YouTube Music 帳號前，可直接貼上 YouTube / YouTube Music 歌曲網址點歌；連結後即可用歌名／歌手關鍵字搜尋並自動寫入主辦人歌單。
              </p>
            ) : null}

            {searchResults.length > 0 ? (
              <div className="mt-3 divide-y divide-slate-100 rounded-2xl bg-slate-50/70 px-3 ring-1 ring-slate-200/70">
                {searchResults.map((track) => {
                  const alreadyAdded = songs.some((s) => s.trackId === track.id);
                  const isAdding = addingTrackId === track.id;
                  return (
                    <div key={track.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="flex min-w-0 items-center gap-2.5">
                        {track.thumbnail ? (
                          <img
                            src={track.thumbnail}
                            alt={track.title}
                            className="h-11 w-14 shrink-0 rounded-lg object-cover ring-1 ring-slate-200"
                          />
                        ) : (
                          <div className="flex h-11 w-14 shrink-0 items-center justify-center rounded-lg bg-slate-200 text-slate-500">
                            <Music className="h-5 w-5" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <a
                            href={track.musicUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block truncate text-xs font-bold text-slate-900 hover:text-rose-700 hover:underline"
                          >
                            {track.title}
                          </a>
                          <p className="truncate text-[11px] text-slate-500">{track.artists}</p>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-1.5">
                        {isAdmin ? (
                          <button
                            type="button"
                            onClick={() =>
                              handleSetThemeSong({
                                videoId: track.id,
                                title: track.title,
                                artists: track.artists,
                                thumbnail: track.thumbnail,
                                url: track.musicUrl,
                              })
                            }
                            className={`inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-[11px] font-semibold transition ${
                              party.themeSong?.videoId === track.id
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-amber-50 hover:text-amber-800'
                            }`}
                          >
                            <Sparkles className="h-3 w-3" />
                            {party.themeSong?.videoId === track.id ? '主題曲' : '設主題曲'}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          disabled={alreadyAdded || isAdding}
                          onClick={() => handleAddTrack(track)}
                          className={`inline-flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                            alreadyAdded
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50'
                          }`}
                        >
                          {alreadyAdded ? (
                            <>
                              <Check className="h-3.5 w-3.5" /> 已點播
                            </>
                          ) : (
                            <>
                              <Plus className="h-3.5 w-3.5" /> {isAdding ? '加入中...' : '點歌'}
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </>
        )}
      </section>

      {/* 大家已點的歌曲清單 */}
      <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
            <Disc3 className="h-4 w-4 text-rose-600" />
            派對點歌清單（{songs.length} 首）
          </h3>
          {canSyncToYoutube ? (
            <span className="rounded-full bg-rose-50 px-2.5 py-0.5 text-[11px] font-semibold text-rose-700">
              即時同步至 YouTube Music
            </span>
          ) : null}
        </div>

        {songs.length === 0 ? (
          <p className="mt-4 rounded-2xl bg-slate-50 py-6 text-center text-xs text-slate-400">
            暫時未有參加者點歌，快點第一首炒熱氣氛吧！
          </p>
        ) : (
          <div className="mt-3 divide-y divide-slate-100">
            {songs.map((song) => {
              const canDelete = Boolean(
                currentUser && (isAdmin || song.requestedByUid === currentUser.uid)
              );
              return (
                <div key={song.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-2.5">
                    {song.albumImage ? (
                      <img
                        src={song.albumImage}
                        alt={song.name}
                        className="h-10 w-14 shrink-0 rounded-lg object-cover ring-1 ring-slate-200"
                      />
                    ) : (
                      <div className="flex h-10 w-14 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400">
                        <Music className="h-4 w-4" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <a
                        href={song.externalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block truncate text-xs font-bold text-slate-900 hover:text-rose-700 hover:underline"
                      >
                        {song.name}
                      </a>
                      <p className="truncate text-[11px] text-slate-500">
                        {song.artists} · 由 <strong className="text-slate-700">{song.requestedByName}</strong> 點播
                      </p>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    {isAdmin ? (
                      <button
                        type="button"
                        onClick={() =>
                          handleSetThemeSong({
                            videoId: song.trackId,
                            title: song.name,
                            artists: song.artists,
                            thumbnail: song.albumImage,
                            url: song.externalUrl,
                          })
                        }
                        title="設為此活動專屬主題曲"
                        className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold transition ${
                          party.themeSong?.videoId === song.trackId
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-slate-100 text-slate-600 hover:bg-amber-50 hover:text-amber-800'
                        }`}
                      >
                        <Sparkles className="h-3 w-3" />
                        {party.themeSong?.videoId === song.trackId ? '主題曲' : '主題'}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        onStartPlayingTrack?.();
                        setPlayingSongId(song.id);
                      }}
                      title="在頁內播放器立即播放"
                      className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold transition ${
                        playingSongId === song.id
                          ? 'bg-rose-600 text-white'
                          : 'bg-rose-50 text-rose-700 hover:bg-rose-100'
                      }`}
                    >
                      <Play className="h-3 w-3" />
                      {playingSongId === song.id ? '播放中' : '播放'}
                    </button>
                    <a
                      href={song.externalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="在 YouTube Music 開啟此曲"
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                    {canDelete ? (
                      <button
                        type="button"
                        disabled={deletingSongId === song.id}
                        aria-label="移除點歌"
                        onClick={() => handleRemoveSong(song)}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
