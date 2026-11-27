import type { User } from 'firebase/auth';
import { onValue, ref, remove, set } from 'firebase/database';
import { rtdb } from './firebase';
import { generateId } from './partyStore';
import { normalizeApiBase } from './mediaApi';
import type { PartySong } from '../types/party';

export interface YoutubeStatus {
  configured: boolean;
  connected: boolean;
  channelTitle: string;
  channelId: string;
  redirectUri: string;
}

export interface YoutubeTrackResult {
  id: string;
  title: string;
  artists: string;
  thumbnail: string;
  musicUrl: string;
  youtubeUrl: string;
}

export function extractYoutubePlaylistId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const listMatch = trimmed.match(/[?&]list=([a-zA-Z0-9_-]+)/);
  if (listMatch) return listMatch[1];
  if (/^(PL|OLAK5uy_|RDCLAK5uy_)[a-zA-Z0-9_-]{10,}$/.test(trimmed)) return trimmed;
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

export async function fetchYoutubeStatus(apiBase: string): Promise<YoutubeStatus> {
  const base = normalizeApiBase(apiBase);
  if (!base) {
    return { configured: false, connected: false, channelTitle: '', channelId: '', redirectUri: '' };
  }
  const res = await fetch(`${base}/api/youtube/status`);
  if (!res.ok) {
    throw new Error(`無法讀取 YouTube Music 狀態（HTTP ${res.status}）`);
  }
  return (await res.json()) as YoutubeStatus;
}

export async function requestYoutubeAuthUrl(
  apiBase: string,
  user: User,
  returnUrl: string
): Promise<{ authUrl: string; redirectUri: string }> {
  const base = normalizeApiBase(apiBase);
  const idToken = await user.getIdToken();
  const res = await fetch(`${base}/api/youtube/auth-url`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ returnUrl }),
  });
  const json = (await res.json()) as { authUrl?: string; redirectUri?: string; error?: string };
  if (!res.ok || !json.authUrl) {
    throw new Error(json.error || `無法取得 YouTube Music 授權網址（HTTP ${res.status}）`);
  }
  return { authUrl: json.authUrl, redirectUri: json.redirectUri || '' };
}

export async function disconnectHostYoutube(apiBase: string, user: User): Promise<void> {
  const base = normalizeApiBase(apiBase);
  const idToken = await user.getIdToken();
  const res = await fetch(`${base}/api/youtube/disconnect`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(json.error || `解除連結失敗（HTTP ${res.status}）`);
  }
}

export async function searchYoutubeMusic(
  apiBase: string,
  query: string
): Promise<YoutubeTrackResult[]> {
  const base = normalizeApiBase(apiBase);
  const q = query.trim();
  if (!base || !q) return [];
  const res = await fetch(`${base}/api/youtube/search?q=${encodeURIComponent(q)}`);
  const json = (await res.json()) as { tracks?: YoutubeTrackResult[]; error?: string };
  if (!res.ok) {
    throw new Error(json.error || `搜尋歌曲失敗（HTTP ${res.status}）`);
  }
  return json.tracks ?? [];
}

export async function createPartyYoutubePlaylist(params: {
  apiBase: string;
  user: User;
  name: string;
  description: string;
}): Promise<{ playlistId: string; playlistUrl: string; name: string }> {
  const base = normalizeApiBase(params.apiBase);
  const idToken = await params.user.getIdToken();
  const res = await fetch(`${base}/api/youtube/create-playlist`, {
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
    throw new Error(json.error || `建立 YouTube Music 歌單失敗（HTTP ${res.status}）`);
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
  track: YoutubeTrackResult;
  user: User;
  requesterName: string;
}): Promise<PartySong> {
  const { apiBase, partyId, playlistId, track, user, requesterName } = params;
  const base = normalizeApiBase(apiBase);
  let syncedToYoutube = false;
  let playlistItemId = '';

  if (base && playlistId) {
    const idToken = await user.getIdToken();
    const res = await fetch(`${base}/api/youtube/add-track`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ playlistId, videoId: track.id }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      playlistItemId?: string;
      error?: string;
    };
    if (!res.ok) {
      throw new Error(json.error || `同步至 YouTube Music 歌單失敗（HTTP ${res.status}）`);
    }
    syncedToYoutube = true;
    playlistItemId = json.playlistItemId || '';
  }

  const songId = generateId('song');
  const record: PartySong = {
    id: songId,
    partyId,
    trackId: track.id,
    uri: `youtube:video:${track.id}`,
    ...(playlistItemId ? { playlistItemId } : {}),
    name: track.title,
    artists: track.artists,
    ...(track.thumbnail ? { albumImage: track.thumbnail } : {}),
    externalUrl: track.musicUrl,
    requestedByUid: user.uid,
    requestedByName: requesterName.trim() || user.displayName || '參加者',
    requestedAt: new Date().toISOString(),
    syncedToYoutube,
  };

  await set(ref(rtdb, `partySongs/${partyId}/${songId}`), record);
  return record;
}

export async function deletePartySong(params: {
  apiBase: string;
  song: PartySong;
  user: User;
}): Promise<void> {
  const { apiBase, song, user } = params;
  const base = normalizeApiBase(apiBase);
  if (base && song.syncedToYoutube && song.playlistItemId) {
    try {
      const idToken = await user.getIdToken();
      await fetch(`${base}/api/youtube/remove-track`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ playlistItemId: song.playlistItemId }),
      });
    } catch {
      // 即使 YouTube 移除失敗仍清除 Firebase 點歌紀錄
    }
  }
  await remove(ref(rtdb, `partySongs/${song.partyId}/${song.id}`));
}
