/// <reference types="@cloudflare/workers-types" />

import {
  getValidUserAccessToken,
  requestSpotifyToken,
  type SpotifyEnv,
} from './spotifyAuth';

export {
  createSpotifyAuthUrl,
  disconnectSpotify,
  getSpotifyRedirectUri,
  getSpotifyStatus,
  handleSpotifyCallback,
  type SpotifyEnv,
} from './spotifyAuth';

export interface SpotifyTrackSummary {
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

export async function searchSpotifyTracks(
  env: SpotifyEnv,
  query: string
): Promise<SpotifyTrackSummary[]> {
  const q = query.trim();
  if (!q) return [];
  let accessToken: string;
  try {
    accessToken = (await getValidUserAccessToken(env)).accessToken;
  } catch {
    accessToken = (await requestSpotifyToken(env, { grant_type: 'client_credentials' }))
      .access_token;
  }
  const params = new URLSearchParams({ q, type: 'track', market: 'HK', limit: '10' });
  const res = await fetch(`https://api.spotify.com/v1/search?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Spotify 搜尋失敗（HTTP ${res.status}）`);
  }
  const json = (await res.json()) as {
    tracks?: {
      items?: Array<{
        id: string;
        uri: string;
        name: string;
        duration_ms: number;
        preview_url: string | null;
        external_urls?: { spotify?: string };
        artists?: Array<{ name: string }>;
        album?: { name?: string; images?: Array<{ url: string }> };
      }>;
    };
  };
  return (json.tracks?.items ?? []).map((item) => ({
    id: item.id,
    uri: item.uri,
    name: item.name,
    artists: (item.artists ?? []).map((a) => a.name).join(', '),
    albumName: item.album?.name || '',
    albumImage: item.album?.images?.[1]?.url || item.album?.images?.[0]?.url || '',
    durationMs: item.duration_ms || 0,
    externalUrl: item.external_urls?.spotify || `https://open.spotify.com/track/${item.id}`,
    previewUrl: item.preview_url || null,
  }));
}

export async function createSpotifyPlaylist(
  env: SpotifyEnv,
  name: string,
  description: string
): Promise<{ playlistId: string; playlistUrl: string; name: string }> {
  const token = await getValidUserAccessToken(env);
  const res = await fetch('https://api.spotify.com/v1/me/playlists', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: name.trim().slice(0, 100) || 'PartyO 聚會歌單',
      description: description.trim().slice(0, 300) || '由 PartyO 參加者共同點歌建立',
      public: true,
    }),
  });
  if (!res.ok) {
    throw new Error(`建立 Spotify 歌單失敗（HTTP ${res.status}）`);
  }
  const json = (await res.json()) as {
    id: string;
    name: string;
    external_urls?: { spotify?: string };
  };
  return {
    playlistId: json.id,
    playlistUrl: json.external_urls?.spotify || `https://open.spotify.com/playlist/${json.id}`,
    name: json.name,
  };
}

export async function addTrackToSpotifyPlaylist(
  env: SpotifyEnv,
  playlistId: string,
  uri: string
): Promise<{ snapshotId: string }> {
  const token = await getValidUserAccessToken(env);
  const res = await fetch(
    `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/tracks`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ uris: [uri] }),
    }
  );
  if (!res.ok) {
    throw new Error(`加入 Spotify 歌單失敗（HTTP ${res.status}）`);
  }
  const json = (await res.json()) as { snapshot_id?: string };
  return { snapshotId: json.snapshot_id || '' };
}

export async function removeTrackFromSpotifyPlaylist(
  env: SpotifyEnv,
  playlistId: string,
  uri: string
): Promise<void> {
  const token = await getValidUserAccessToken(env);
  const res = await fetch(
    `https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/tracks`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ tracks: [{ uri }] }),
    }
  );
  if (!res.ok) {
    throw new Error(`從 Spotify 歌單移除歌曲失敗（HTTP ${res.status}）`);
  }
}
