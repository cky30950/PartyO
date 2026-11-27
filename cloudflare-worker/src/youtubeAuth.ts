/// <reference types="@cloudflare/workers-types" />

export interface YoutubeEnv {
  PARTYO_BUCKET: R2Bucket;
  YOUTUBE_CLIENT_ID?: string;
  YOUTUBE_CLIENT_SECRET?: string;
  ALLOWED_ORIGIN?: string;
}

export interface StoredYoutubeSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  channelTitle: string;
  channelId: string;
  updatedAt: string;
}

const TOKEN_STORE_KEY = 'youtube/host_link.json';
const STATE_KEY_PREFIX = 'youtube/oauth_state_';
const YOUTUBE_SCOPE = 'https://www.googleapis.com/auth/youtube';

export function getYoutubeRedirectUri(origin: string): string {
  return `${origin}/api/youtube/callback`;
}

function sanitizeAppBase(env: YoutubeEnv, rawReturnUrl: string): string {
  const configured = (env.ALLOWED_ORIGIN || '').trim();
  try {
    const parsed = new URL(rawReturnUrl);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return `${parsed.origin}${parsed.pathname}`;
    }
  } catch {
    // ignore invalid url
  }
  return configured && configured !== '*' ? configured : '/';
}

function extractPartyParam(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const p = parsed.searchParams.get('p') || '';
    return p.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  } catch {
    return '';
  }
}

async function loadStoredLink(env: YoutubeEnv): Promise<StoredYoutubeSession | null> {
  const obj = await env.PARTYO_BUCKET.get(TOKEN_STORE_KEY);
  if (!obj) return null;
  try {
    return (await obj.json()) as StoredYoutubeSession;
  } catch {
    return null;
  }
}

async function saveStoredLink(env: YoutubeEnv, record: StoredYoutubeSession): Promise<void> {
  await env.PARTYO_BUCKET.put(TOKEN_STORE_KEY, JSON.stringify(record), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });
}

export async function disconnectYoutube(env: YoutubeEnv): Promise<void> {
  await env.PARTYO_BUCKET.delete(TOKEN_STORE_KEY);
}

export async function getYoutubeStatus(
  env: YoutubeEnv,
  origin: string
): Promise<{
  configured: boolean;
  connected: boolean;
  channelTitle: string;
  channelId: string;
  redirectUri: string;
}> {
  const configured = Boolean(
    (env.YOUTUBE_CLIENT_ID || '').trim() && (env.YOUTUBE_CLIENT_SECRET || '').trim()
  );
  const current = configured ? await loadStoredLink(env) : null;
  return {
    configured,
    connected: Boolean(current?.refreshToken),
    channelTitle: current?.channelTitle || '',
    channelId: current?.channelId || '',
    redirectUri: getYoutubeRedirectUri(origin),
  };
}

export async function requestYoutubeToken(
  env: YoutubeEnv,
  formParams: Record<string, string>
): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}> {
  const clientId = (env.YOUTUBE_CLIENT_ID || '').trim();
  const clientSecret = (env.YOUTUBE_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) {
    throw new Error('伺服器尚未設定 YouTube OAuth 憑證');
  }
  const body = new URLSearchParams({
    ...formParams,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    let detail = '';
    try {
      const errJson = (await res.json()) as { error?: string; error_description?: string };
      detail = errJson.error_description || errJson.error || '';
    } catch {
      // ignore
    }
    throw new Error(
      `YouTube 授權驗證失敗（HTTP ${res.status}${detail ? `：${detail}` : ''}）`
    );
  }

  return (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
}

export async function getValidYoutubeAccessToken(
  env: YoutubeEnv
): Promise<StoredYoutubeSession> {
  const current = await loadStoredLink(env);
  if (!current || !current.refreshToken) {
    throw new Error('主辦人尚未連結 YouTube Music 帳號');
  }

  if (current.accessToken && current.expiresAt > Date.now() + 120_000) {
    return current;
  }

  const refreshed = await requestYoutubeToken(env, {
    grant_type: 'refresh_token',
    refresh_token: current.refreshToken,
  });

  const updated: StoredYoutubeSession = {
    ...current,
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token || current.refreshToken,
    expiresAt: Date.now() + Math.max(60, refreshed.expires_in - 60) * 1000,
    updatedAt: new Date().toISOString(),
  };
  await saveStoredLink(env, updated);
  return updated;
}

function buildCallbackResponse(baseUrl: string, partyId: string, status: 'connected' | 'error'): Response {
  const qs = new URLSearchParams();
  if (partyId) qs.set('p', partyId);
  qs.set('yt', status);
  const href = `${baseUrl}?${qs.toString()}`;
  return new Response(null, { status: 302, headers: { Location: href } });
}

export async function createYoutubeAuthUrl(
  env: YoutubeEnv,
  origin: string,
  returnUrl: string
): Promise<{ authUrl: string; redirectUri: string }> {
  const clientId = (env.YOUTUBE_CLIENT_ID || '').trim();
  if (!clientId) {
    throw new Error('伺服器尚未設定 YouTube OAuth 憑證');
  }
  const redirectUri = getYoutubeRedirectUri(origin);
  const state = crypto.randomUUID().replace(/-/g, '');
  const baseUrl = sanitizeAppBase(env, returnUrl);
  const partyId = extractPartyParam(returnUrl);

  await env.PARTYO_BUCKET.put(
    `${STATE_KEY_PREFIX}${state}.json`,
    JSON.stringify({ baseUrl, partyId, createdAt: Date.now() }),
    { httpMetadata: { contentType: 'application/json; charset=utf-8' } }
  );

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: YOUTUBE_SCOPE,
    redirect_uri: redirectUri,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });

  return {
    authUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    redirectUri,
  };
}

export async function handleYoutubeCallback(
  env: YoutubeEnv,
  url: URL
): Promise<Response> {
  const code = url.searchParams.get('code') || '';
  const state = url.searchParams.get('state') || '';
  const oauthError = url.searchParams.get('error') || '';

  let baseUrl = sanitizeAppBase(env, '');
  let partyId = '';
  if (state) {
    const stateKey = `${STATE_KEY_PREFIX}${state.replace(/[^a-zA-Z0-9]/g, '')}.json`;
    const stateObj = await env.PARTYO_BUCKET.get(stateKey);
    if (stateObj) {
      try {
        const parsed = (await stateObj.json()) as { baseUrl?: string; partyId?: string };
        if (parsed.baseUrl) baseUrl = sanitizeAppBase(env, parsed.baseUrl);
        partyId = (parsed.partyId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
      } catch {
        // ignore parse error
      }
      await env.PARTYO_BUCKET.delete(stateKey);
    }
  }

  if (oauthError || !code) {
    return buildCallbackResponse(baseUrl, partyId, 'error');
  }

  try {
    const redirectUri = getYoutubeRedirectUri(url.origin);
    const tokenData = await requestYoutubeToken(env, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    });

    const channelRes = await fetch(
      'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
      { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
    );
    let channelTitle = 'YouTube Music 主辦人';
    let channelId = '';
    if (channelRes.ok) {
      const chJson = (await channelRes.json()) as {
        items?: Array<{ id?: string; snippet?: { title?: string } }>;
      };
      const first = chJson.items?.[0];
      if (first?.id) channelId = first.id;
      if (first?.snippet?.title) channelTitle = first.snippet.title;
    }

    const existing = await loadStoredLink(env);
    await saveStoredLink(env, {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token || existing?.refreshToken || '',
      expiresAt: Date.now() + Math.max(60, tokenData.expires_in - 60) * 1000,
      channelTitle,
      channelId,
      updatedAt: new Date().toISOString(),
    });

    return buildCallbackResponse(baseUrl, partyId, 'connected');
  } catch {
    return buildCallbackResponse(baseUrl, partyId, 'error');
  }
}
