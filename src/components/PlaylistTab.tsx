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
  Plus,
  Search,
  Trash2,
  Unlink,
} from 'lucide-react';
import type { Party, PartySong } from '../types/party';
import {
  createPartySpotifyPlaylist,
  deletePartySong,
  disconnectHostSpotify,
  extractSpotifyPlaylistId,
  fetchSpotifyStatus,
  requestPartySong,
  requestSpotifyAuthUrl,
  searchSpotifyCatalog,
  subscribePartySongs,
  type SpotifyStatus,
  type SpotifyTrackResult,
} from '../lib/spotifyApi';

interface PlaylistTabProps {
  party: Party;
  isAdmin: boolean;
  currentUser: User | null;
  authBusy: boolean;
  mediaApiBase: string;
  onSignIn: () => Promise<void>;
  onUpdateParty: (updated: Party) => Promise<void>;
}

function formatDuration(ms?: number): string {
  if (!ms || ms <= 0) return '';
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, '0')}`;
}

export function PlaylistTab({
  party,
  isAdmin,
  currentUser,
  authBusy,
  mediaApiBase,
  onSignIn,
  onUpdateParty,
}: PlaylistTabProps) {
  const [songs, setSongs] = useState<PartySong[]>([]);
  const [status, setStatus] = useState<SpotifyStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);

  const [manualPlaylistInput, setManualPlaylistInput] = useState('');
  const [showManualLink, setShowManualLink] = useState(false);
  const [copiedRedirect, setCopiedRedirect] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SpotifyTrackResult[]>([]);
  const [addingTrackId, setAddingTrackId] = useState<string | null>(null);
  const [deletingSongId, setDeletingSongId] = useState<string | null>(null);

  useEffect(() => {
    return subscribePartySongs(party.id, setSongs);
  }, [party.id]);

  useEffect(() => {
    let cancelled = false;
    setLoadingStatus(true);
    fetchSpotifyStatus(mediaApiBase)
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

  // 若剛從 Spotify OAuth 回調回來，顯示提示並清掉網址參數
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sp = params.get('spotify');
    if (!sp) return;
    if (sp === 'connected') {
      toast.success('已成功連結主辦人 Spotify 帳號！');
      fetchSpotifyStatus(mediaApiBase).then(setStatus).catch(() => {});
    } else if (sp === 'error') {
      toast.error('Spotify 授權失敗，請檢查 Redirect URI 與金鑰設定');
    }
    params.delete('spotify');
    const nextUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
    window.history.replaceState({}, '', nextUrl);
  }, [mediaApiBase]);

  const hasLinkedPlaylist = Boolean(party.spotifyPlaylistId);
  const canSearchSpotify = Boolean(status?.configured);
  const canSyncToSpotify = Boolean(status?.connected && party.spotifyPlaylistId);

  async function handleConnectSpotify() {
    if (!currentUser || !isAdmin) return;
    setConnecting(true);
    try {
      const { authUrl } = await requestSpotifyAuthUrl(
        mediaApiBase,
        currentUser,
        window.location.href
      );
      window.location.href = authUrl;
    } catch (err) {
      const msg = err instanceof Error ? err.message : '無法啟動 Spotify 授權';
      toast.error(msg);
      setConnecting(false);
    }
  }

  async function handleDisconnectSpotify() {
    if (!currentUser || !isAdmin) return;
    const ok = window.confirm('確定要解除主辦人 Spotify 帳號連結嗎？');
    if (!ok) return;
    try {
      await disconnectHostSpotify(mediaApiBase, currentUser);
      const next = await fetchSpotifyStatus(mediaApiBase);
      setStatus(next);
      toast.success('已解除 Spotify 帳號連結');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '解除失敗');
    }
  }

  async function handleCreatePlaylist() {
    if (!currentUser || !isAdmin) return;
    setCreatingPlaylist(true);
    try {
      const created = await createPartySpotifyPlaylist({
        apiBase: mediaApiBase,
        user: currentUser,
        name: `🎉 ${party.title}`,
        description: `由 PartyO 參加者共同點歌建立的聚會歌單（搞手：${party.hostName}）`,
      });
      await onUpdateParty({
        ...party,
        spotifyPlaylistId: created.playlistId,
        spotifyPlaylistUrl: created.playlistUrl,
        spotifyPlaylistName: created.name,
      });
      toast.success(`已建立並綁定 Spotify 歌單「${created.name}」`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '建立歌單失敗');
    } finally {
      setCreatingPlaylist(false);
    }
  }

  async function handleBindManualPlaylist(e: FormEvent) {
    e.preventDefault();
    if (!isAdmin) return;
    const id = extractSpotifyPlaylistId(manualPlaylistInput);
    if (!id) {
      toast.error('請貼上有效的 Spotify 歌單網址（例如 open.spotify.com/playlist/...）');
      return;
    }
    await onUpdateParty({
      ...party,
      spotifyPlaylistId: id,
      spotifyPlaylistUrl: `https://open.spotify.com/playlist/${id}`,
      spotifyPlaylistName: party.spotifyPlaylistName || `${party.title} 聚會歌單`,
    });
    setManualPlaylistInput('');
    setShowManualLink(false);
    toast.success('已綁定 Spotify 歌單');
  }

  async function handleUnbindPlaylist() {
    if (!isAdmin) return;
    await onUpdateParty({
      ...party,
      spotifyPlaylistId: '',
      spotifyPlaylistUrl: '',
      spotifyPlaylistName: '',
    });
    toast.success('已解除此活動的 Spotify 歌單綁定');
  }

  async function handleSearch(e: FormEvent) {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;
    setSearching(true);
    try {
      const results = await searchSpotifyCatalog(mediaApiBase, q);
      setSearchResults(results);
      if (results.length === 0) {
        toast.info('找不到相符的歌曲，換個關鍵字試試');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '搜尋失敗');
    } finally {
      setSearching(false);
    }
  }

  async function handleAddTrack(track: SpotifyTrackResult) {
    if (!currentUser) {
      toast.error('請先登入 Google 帳號即可點歌');
      return;
    }
    if (songs.some((s) => s.trackId === track.id)) {
      toast.info(`「${track.name}」已經在點歌單裡了`);
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
        playlistId: canSyncToSpotify ? party.spotifyPlaylistId : undefined,
        track,
        user: currentUser,
        requesterName,
      });
      toast.success(
        canSyncToSpotify
          ? `已點歌「${track.name}」並同步加入 Spotify 歌單！`
          : `已加入派對點歌單「${track.name}」`
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
        playlistId: canSyncToSpotify ? party.spotifyPlaylistId : undefined,
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

  return (
    <div className="space-y-5">
      {/* 頂部：聚會共同點歌單與主辦人 Spotify 綁定 */}
      <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
              <Music className="h-4 w-4 text-emerald-600" />
              Spotify 聚會共同點歌單
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              參加者無需登入 Spotify，直接搜尋歌曲即可即時加入主辦人的派對歌單。
            </p>
          </div>
          {party.spotifyPlaylistUrl ? (
            <a
              href={party.spotifyPlaylistUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700"
            >
              <ExternalLink className="h-3.5 w-3.5" /> 在 Spotify 開啟
            </a>
          ) : null}
        </div>

        {/* 主辦人 Spotify 設定與歌單管理 */}
        {isAdmin ? (
          <div className="mt-3.5 space-y-2.5 rounded-2xl bg-slate-50 p-3.5 ring-1 ring-slate-200/80">
            {loadingStatus ? (
              <p className="text-xs text-slate-400">檢查 Spotify 連線狀態中...</p>
            ) : !status?.configured ? (
              <div className="space-y-2 text-xs text-slate-600">
                <p className="font-bold text-slate-800">尚未設定 Spotify 開發者金鑰</p>
                <p className="text-[11px] leading-relaxed">
                  到 Spotify Developer Dashboard 建立免費 App，將以下 Redirect URI 加入 App 設定，再把{' '}
                  <code className="rounded bg-slate-200 px-1">SPOTIFY_CLIENT_ID</code> 與{' '}
                  <code className="rounded bg-slate-200 px-1">SPOTIFY_CLIENT_SECRET</code> 存入 Worker Secrets：
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
                        toast.success('已複製 Redirect URI');
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
                  <p className="text-xs font-bold text-slate-800">步驟 1：連結主辦人 Spotify 帳號</p>
                  <p className="text-[11px] text-slate-500">
                    授權一次後，參加者點歌會自動同步寫入你的 Spotify 歌單。
                  </p>
                </div>
                <button
                  type="button"
                  disabled={connecting}
                  onClick={handleConnectSpotify}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                >
                  <Disc3 className="h-4 w-4" />
                  {connecting ? '跳轉授權中...' : '連結我的 Spotify'}
                </button>
              </div>
            ) : (
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800">
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                    已連結 Spotify：{status.displayName || status.userId}
                  </span>
                  <button
                    type="button"
                    onClick={handleDisconnectSpotify}
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
                      className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      {creatingPlaylist ? '建立中...' : '一鍵建立此活動專屬 Spotify 歌單'}
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
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white px-3 py-2 text-xs ring-1 ring-emerald-200">
                    <span className="truncate font-semibold text-slate-800">
                      已綁定歌單：{party.spotifyPlaylistName || party.spotifyPlaylistId}
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

            {/* 即使尚未設金鑰，主辦人也可手動貼上既有 Spotify 歌單連結先嵌入播放 */}
            {!status?.connected && !hasLinkedPlaylist ? (
              <div className="border-t border-slate-200/70 pt-2">
                <button
                  type="button"
                  onClick={() => setShowManualLink((v) => !v)}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 hover:text-emerald-700"
                >
                  <Link2 className="h-3.5 w-3.5" />
                  {showManualLink ? '收起手動貼上歌單' : '或先貼上現有 Spotify 歌單連結嵌入播放'}
                </button>
              </div>
            ) : null}

            {showManualLink ? (
              <form onSubmit={handleBindManualPlaylist} className="flex flex-col gap-2 pt-1 sm:flex-row">
                <input
                  type="text"
                  value={manualPlaylistInput}
                  onChange={(e) => setManualPlaylistInput(e.target.value)}
                  placeholder="貼上 Spotify 歌單網址（open.spotify.com/playlist/...）"
                  className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-emerald-500"
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

        {/* 內嵌官方 Spotify 播放器 */}
        {party.spotifyPlaylistId ? (
          <div className="mt-4 overflow-hidden rounded-2xl ring-1 ring-slate-200/80">
            <iframe
              title="Spotify 聚會歌單播放器"
              src={`https://open.spotify.com/embed/playlist/${encodeURIComponent(party.spotifyPlaylistId)}?utm_source=generator`}
              width="100%"
              height="352"
              allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
              loading="lazy"
              className="block w-full border-0"
            />
          </div>
        ) : null}
      </section>

      {/* 搜尋歌曲並點歌 */}
      <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
        <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
          <Search className="h-4 w-4 text-brand-600" />
          搜尋歌曲加入派對歌單
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
        ) : !canSearchSpotify ? (
          <p className="mt-3 rounded-2xl bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800 ring-1 ring-amber-200">
            主辦人完成 Spotify 連線設定後，即可在此直接搜尋曲庫點歌。
          </p>
        ) : (
          <>
            <form onSubmit={handleSearch} className="mt-3 flex gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="輸入歌名、歌手（例如：陳奕迅、MC 張天賦、APT...）"
                className="flex-1 rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
              />
              <button
                type="submit"
                disabled={searching || !searchQuery.trim()}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
              >
                <Search className="h-4 w-4" />
                {searching ? '搜尋中...' : '搜尋'}
              </button>
            </form>

            {searchResults.length > 0 ? (
              <div className="mt-3 divide-y divide-slate-100 rounded-2xl bg-slate-50/70 px-3 ring-1 ring-slate-200/70">
                {searchResults.map((track) => {
                  const alreadyAdded = songs.some((s) => s.trackId === track.id);
                  const isAdding = addingTrackId === track.id;
                  return (
                    <div key={track.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="flex min-w-0 items-center gap-2.5">
                        {track.albumImage ? (
                          <img
                            src={track.albumImage}
                            alt={track.name}
                            className="h-11 w-11 shrink-0 rounded-lg object-cover ring-1 ring-slate-200"
                          />
                        ) : (
                          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-slate-200 text-slate-500">
                            <Music className="h-5 w-5" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <a
                            href={track.externalUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block truncate text-xs font-bold text-slate-900 hover:text-emerald-700 hover:underline"
                          >
                            {track.name}
                          </a>
                          <p className="truncate text-[11px] text-slate-500">
                            {track.artists}
                            {track.durationMs ? ` · ${formatDuration(track.durationMs)}` : ''}
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={alreadyAdded || isAdding}
                        onClick={() => handleAddTrack(track)}
                        className={`inline-flex shrink-0 items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                          alreadyAdded
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50'
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
            <Disc3 className="h-4 w-4 text-emerald-600" />
            派對點歌清單（{songs.length} 首）
          </h3>
          {canSyncToSpotify ? (
            <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
              即時同步至 Spotify
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
                        className="h-10 w-10 shrink-0 rounded-lg object-cover ring-1 ring-slate-200"
                      />
                    ) : (
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400">
                        <Music className="h-4 w-4" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <a
                        href={song.externalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block truncate text-xs font-bold text-slate-900 hover:text-emerald-700 hover:underline"
                      >
                        {song.name}
                      </a>
                      <p className="truncate text-[11px] text-slate-500">
                        {song.artists} · 由 <strong className="text-slate-700">{song.requestedByName}</strong> 點播
                      </p>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <a
                      href={song.externalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="在 Spotify 開啟此曲"
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-emerald-600"
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
