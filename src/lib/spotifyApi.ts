import type { User } from 'firebase/auth';
import { onValue, ref, remove, set } from 'firebase/database';
import { rtdb } from './firebase';
import { generateId } from './partyStore';
import { normalizeApiBase } from './mediaApi';
import type { PartySong } from '../types/party';

export interface SpotifyStatus {
  configured: boolean;
  connected: boolean;
  displayName: string;
  userId: string;
  redirectUri: string;
}

export interface SpotifyTrackResult {
  id: string;
  uri: string;
  name: string;
  artists: string;
  albumName: string;
  albumImage: string;
  durationMs: number;
  externalUrl: string;
  previewUrl: string | null;
}

export function extractSpotifyPlaylistId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const urlMatch = trimmed.match(/spotify\.com\/playlist\/([a-zA-Z0-9]+)/);
  if (urlMatch) return urlMatch[1];
  const uriMatch = trimmed.match(/spotify:playlist:([a-zA-Z0-9]+)/);
  if (uriMatch) return uriMatch[1];
  if (/^[a-zA-Z0-9]{15,30}$/.test(trimmed)) return trimmed;
  return null;
}

export function subscribePartySongs(
  partyId: string,
  onChange: (songs: PartySong[]) => void
): () => void {
  const songsRef = ref(rtdb, `partySongs/${partyId}`);
  return onValue(
    songsRef,
    (snap) => {
      const raw = snap.val() as Record<string, PartySong> | null;
      if (!raw || typeof raw !== 'object') {
        onChange([]);
        return;
      }
      const list = Object.values(raw)
        .filter((s): s is PartySong => Boolean(s && s.id && s.name))
        .sort((a, b) => (b.requestedAt || '').localeCompare(a.requestedAt || ''));
      onChange(list);
    },
    () => {
      onChange([]);
    }
  );
}

export async function fetchSpotifyStatus(apiBase: string): Promise<SpotifyStatus> {
  const base = normalizeApiBase(apiBase);
  if (!base) {
    return { configured: false, connected: false, displayName: '', userId: '', redirectUri: '' };
  }
  const res = await fetch(`${base}/api/spotify/status`);
  if (!res.ok) {
    throw new Error(`無法讀取 Spotify 狀態（HTTP ${res.status}）`);
  }
  return (await res.json()) as SpotifyStatus;
}

export async function requestSpotifyAuthUrl(
  apiBase: string,
  user: User,
  returnUrl: string
): Promise<{ authUrl: string; redirectUri: string }> {
  const base = normalizeApiBase(apiBase);
  const idToken = await user.getIdToken();
  const res = await fetch(`${base}/api/spotify/auth-url`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ returnUrl }),
  });
  const json = (await res.json()) as { authUrl?: string; redirectUri?: string; error?: string };
  if (!res.ok || !json.authUrl) {
    throw new Error(json.error || `無法取得 Spotify 授權網址（HTTP ${res.status}）`);
  }
  return { authUrl: json.authUrl, redirectUri: json.redirectUri || '' };
}

export async function disconnectHostSpotify(apiBase: string, user: User): Promise<void> {
  const base = normalizeApiBase(apiBase);
  const idToken = await user.getIdToken();
  const res = await fetch(`${base}/api/spotify/disconnect`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(json.error || `解除連結失敗（HTTP ${res.status}）`);
  }
}

export async function searchSpotifyCatalog(
  apiBase: string,
  query: string
): Promise<SpotifyTrackResult[]> {
  const base = normalizeApiBase(apiBase);
  const q = query.trim();
  if (!base || !q) return [];
  const res = await fetch(`${base}/api/spotify/search?q=${encodeURIComponent(q)}`);
  const json = (await res.json()) as { tracks?: SpotifyTrackResult[]; error?: string };
  if (!res.ok) {
    throw new Error(json.error || `搜尋歌曲失敗（HTTP ${res.status}）`);
  }
  return json.tracks ?? [];
}

export async function createPartySpotifyPlaylist(params: {
  apiBase: string;
  user: User;
  name: string;
  description: string;
}): Promise<{ playlistId: string; playlistUrl: string; name: string }> {
  const base = normalizeApiBase(params.apiBase);
  const idToken = await params.user.getIdToken();
  const res = await fetch(`${base}/api/spotify/create-playlist`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: params.name, description: params.description }),
  });
  const json = (await res.json()) as {
    playlistId?: string;
    playlistUrl?: string;
    name?: string;
    error?: string;
  };
  if (!res.ok || !json.playlistId || !json.playlistUrl) {
    throw new Error(json.error || `建立 Spotify 歌單失敗（HTTP ${res.status}）`);
  }
  return {
    playlistId: json.playlistId,
    playlistUrl: json.playlistUrl,
    name: json.name || params.name,
  };
}

export async function requestPartySong(params: {
  apiBase: string;
  partyId: string;
  playlistId?: string;
  track: SpotifyTrackResult;
  user: User;
  requesterName: string;
}): Promise<PartySong> {
  const { apiBase, partyId, playlistId, track, user, requesterName } = params;
  const base = normalizeApiBase(apiBase);
  let syncedToSpotify = false;

  if (base && playlistId) {
    const idToken = await user.getIdToken();
    const res = await fetch(`${base}/api/spotify/add-track`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ playlistId, uri: track.uri }),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      throw new Error(json.error || `同步至 Spotify 歌單失敗（HTTP ${res.status}）`);
    }
    syncedToSpotify = true;
  }

  const songId = generateId('song');
  const record: PartySong = {
    id: songId,
    partyId,
    trackId: track.id,
    uri: track.uri,
    name: track.name,
    artists: track.artists,
    ...(track.albumName ? { albumName: track.albumName } : {}),
    ...(track.albumImage ? { albumImage: track.albumImage } : {}),
    ...(track.durationMs ? { durationMs: track.durationMs } : {}),
    externalUrl: track.externalUrl,
    requestedByUid: user.uid,
    requestedByName: requesterName.trim() || user.displayName || '參加者',
    requestedAt: new Date().toISOString(),
    syncedToSpotify,
  };

  await set(ref(rtdb, `partySongs/${partyId}/${songId}`), record);
  return record;
}

export async function deletePartySong(params: {
  apiBase: string;
  playlistId?: string;
  song: PartySong;
  user: User;
}): Promise<void> {
  const { apiBase, playlistId, song, user } = params;
  const base = normalizeApiBase(apiBase);
  if (base && playlistId && song.syncedToSpotify) {
    try {
      const idToken = await user.getIdToken();
      await fetch(`${base}/api/spotify/remove-track`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ playlistId, uri: song.uri }),
      });
    } catch {
      // 即使 Spotify 移除失敗仍清除 Firebase 點歌紀錄
    }
  }
  await remove(ref(rtdb, `partySongs/${song.partyId}/${song.id}`));
}
