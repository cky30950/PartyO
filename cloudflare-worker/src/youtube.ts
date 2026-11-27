/// <reference types="@cloudflare/workers-types" />

import { getValidYoutubeAccessToken, type YoutubeEnv } from './youtubeAuth';

export {
  createYoutubeAuthUrl,
  disconnectYoutube,
  getYoutubeRedirectUri,
  getYoutubeStatus,
  handleYoutubeCallback,
  type YoutubeEnv,
} from './youtubeAuth';

export interface YoutubeTrackSummary {
  id: string;
  title: string;
  artists: string;
  thumbnail: string;
  musicUrl: string;
  youtubeUrl: string;
}

async function readGoogleErrorMessage(res: Response): Promise<string> {
  try {
    const raw = await res.text();
    if (!raw) return '';
    try {
      const parsed = JSON.parse(raw) as { error?: { message?: string } };
      if (parsed.error?.message) return parsed.error.message;
    } catch {
      return raw.slice(0, 140);
    }
  } catch {
    // ignore
  }
  return '';
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function extractVideoIdFromInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const watchMatch = trimmed.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (watchMatch) return watchMatch[1];
  const shortMatch = trimmed.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (shortMatch) return shortMatch[1];
  const shortsMatch = trimmed.match(/youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/);
  if (shortsMatch) return shortsMatch[1];
  return null;
}

export async function searchYoutubeMusicTracks(
  env: YoutubeEnv,
  query: string
): Promise<YoutubeTrackSummary[]> {
  const q = query.trim();
  if (!q) return [];

  // 若參加者直接貼上 YouTube / YouTube Music 連結，直接讀取該首歌曲（不耗 search 配額）
  const directVideoId = extractVideoIdFromInput(q);
  if (directVideoId) {
    try {
      const token = await getValidYoutubeAccessToken(env);
      const videoRes = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${encodeURIComponent(directVideoId)}`,
        { headers: { Authorization: `Bearer ${token.accessToken}` } }
      );
      if (videoRes.ok) {
        const vJson = (await videoRes.json()) as {
          items?: Array<{
            id: string;
            snippet?: {
              title?: string;
              channelTitle?: string;
              thumbnails?: { medium?: { url?: string }; default?: { url?: string } };
            };
          }>;
        };
        const item = vJson.items?.[0];
        if (item) {
          return [
            {
              id: item.id,
              title: decodeHtmlEntities(item.snippet?.title || directVideoId),
              artists: decodeHtmlEntities(
                (item.snippet?.channelTitle || '').replace(/\s*-\s*Topic$/i, '')
              ),
              thumbnail:
                item.snippet?.thumbnails?.medium?.url ||
                item.snippet?.thumbnails?.default?.url ||
                `https://i.ytimg.com/vi/${item.id}/mqdefault.jpg`,
              musicUrl: `https://music.youtube.com/watch?v=${item.id}`,
              youtubeUrl: `https://www.youtube.com/watch?v=${item.id}`,
            },
          ];
        }
      }
    } catch {
      // Fallback to YouTube oEmbed when host OAuth is not connected yet
    }

    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${directVideoId}`)}&format=json`;
    const oembedRes = await fetch(oembedUrl);
    if (oembedRes.ok) {
      const oJson = (await oembedRes.json()) as {
        title?: string;
        author_name?: string;
        thumbnail_url?: string;
      };
      return [
        {
          id: directVideoId,
          title: oJson.title || directVideoId,
          artists: (oJson.author_name || '').replace(/\s*-\s*Topic$/i, ''),
          thumbnail: oJson.thumbnail_url || `https://i.ytimg.com/vi/${directVideoId}/mqdefault.jpg`,
          musicUrl: `https://music.youtube.com/watch?v=${directVideoId}`,
          youtubeUrl: `https://www.youtube.com/watch?v=${directVideoId}`,
        },
      ];
    }
    return [];
  }

  // 一般關鍵字搜尋：使用主辦人 OAuth Token 呼叫 YouTube Data API v3（音樂分類 videoCategoryId=10）
  const token = await getValidYoutubeAccessToken(env);
  const params = new URLSearchParams({
    part: 'snippet',
    type: 'video',
    videoCategoryId: '10',
    regionCode: 'HK',
    maxResults: '8',
    q,
  });
  const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token.accessToken}` },
  });
  if (!res.ok) {
    const detail = await readGoogleErrorMessage(res);
    throw new Error(
      `YouTube Music 搜尋失敗（HTTP ${res.status}${detail ? `：${detail}` : ''}）`
    );
  }
  const json = (await res.json()) as {
    items?: Array<{
      id?: { videoId?: string };
      snippet?: {
        title?: string;
        channelTitle?: string;
        thumbnails?: { medium?: { url?: string }; default?: { url?: string } };
      };
    }>;
  };
  return (json.items ?? [])
    .filter((item) => Boolean(item.id?.videoId))
    .map((item) => {
      const videoId = item.id!.videoId!;
      return {
        id: videoId,
        title: decodeHtmlEntities(item.snippet?.title || ''),
        artists: decodeHtmlEntities(
          (item.snippet?.channelTitle || '').replace(/\s*-\s*Topic$/i, '')
        ),
        thumbnail:
          item.snippet?.thumbnails?.medium?.url ||
          item.snippet?.thumbnails?.default?.url ||
          `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
        musicUrl: `https://music.youtube.com/watch?v=${videoId}`,
        youtubeUrl: `https://www.youtube.com/watch?v=${videoId}`,
      };
    });
}

export async function createYoutubePlaylist(
  env: YoutubeEnv,
  title: string,
  description: string
): Promise<{ playlistId: string; playlistUrl: string; name: string }> {
  const token = await getValidYoutubeAccessToken(env);
  const cleanTitle = title.trim().slice(0, 120) || 'PartyO 聚會歌單';
  const cleanDesc = description.trim().slice(0, 400) || '由 PartyO 參加者共同點歌建立';

  const res = await fetch(
    'https://www.googleapis.com/youtube/v3/playlists?part=snippet,status',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        snippet: {
          title: cleanTitle,
          description: cleanDesc,
        },
        status: {
          privacyStatus: 'unlisted',
        },
      }),
    }
  );
  if (!res.ok) {
    const detail = await readGoogleErrorMessage(res);
    throw new Error(
      `建立 YouTube Music 歌單失敗（HTTP ${res.status}${detail ? `：${detail}` : ''}）`
    );
  }
  const json = (await res.json()) as { id: string; snippet?: { title?: string } };
  return {
    playlistId: json.id,
    playlistUrl: `https://music.youtube.com/playlist?list=${json.id}`,
    name: json.snippet?.title || cleanTitle,
  };
}

export async function addTrackToYoutubePlaylist(
  env: YoutubeEnv,
  playlistId: string,
  videoId: string
): Promise<{ playlistItemId: string }> {
  const token = await getValidYoutubeAccessToken(env);
  const res = await fetch(
    'https://www.googleapis.com/youtube/v3/playlistItems?part=snippet',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        snippet: {
          playlistId,
          resourceId: {
            kind: 'youtube#video',
            videoId,
          },
        },
      }),
    }
  );
  if (!res.ok) {
    const detail = await readGoogleErrorMessage(res);
    throw new Error(
      `加入 YouTube Music 歌單失敗（HTTP ${res.status}${detail ? `：${detail}` : ''}）`
    );
  }
  const json = (await res.json()) as { id?: string };
  return { playlistItemId: json.id || '' };
}

export async function removeTrackFromYoutubePlaylist(
  env: YoutubeEnv,
  playlistItemId: string
): Promise<void> {
  const token = await getValidYoutubeAccessToken(env);
  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/playlistItems?id=${encodeURIComponent(playlistItemId)}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
      },
    }
  );
  if (!res.ok && res.status !== 404) {
    const detail = await readGoogleErrorMessage(res);
    throw new Error(
      `從 YouTube Music 歌單移除失敗（HTTP ${res.status}${detail ? `：${detail}` : ''}）`
    );
  }
}
