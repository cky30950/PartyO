/// <reference types="@cloudflare/workers-types" />

export interface SpotifyEnv {
  PARTYO_BUCKET: R2Bucket;
  SPOTIFY_CLIENT_ID?: string;
  SPOTIFY_CLIENT_SECRET?: string;
  ALLOWED_ORIGIN?: string;
}

export interface StoredSpotifySession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  displayName: string;
  userId: string;
  updatedAt: string;
}

const TOKEN_STORE_KEY = 'spotify/host_link.json';

export function getSpotifyRedirectUri(origin: string): string {
  return `${origin}/api/spotify/callback`;
}

async function loadStoredLink(env: SpotifyEnv): Promise<StoredSpotifySession | null> {
  const obj = await env.PARTYO_BUCKET.get(TOKEN_STORE_KEY);
  if (!obj) return null;
  try {
    return (await obj.json()) as StoredSpotifySession;
  } catch {
    return null;
  }
}

async function saveStoredLink(env: SpotifyEnv, record: StoredSpotifySession): Promise<void> {
  await env.PARTYO_BUCKET.put(TOKEN_STORE_KEY, JSON.stringify(record), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });
}

export async function disconnectSpotify(env: SpotifyEnv): Promise<void> {
  await env.PARTYO_BUCKET.delete(TOKEN_STORE_KEY);
}

export async function getSpotifyStatus(
  env: SpotifyEnv,
  origin: string
): Promise<{
  configured: boolean;
  connected: boolean;
  displayName: string;
  userId: string;
  redirectUri: string;
}> {
  const configured = Boolean(
    (env.SPOTIFY_CLIENT_ID || '').trim() && (env.SPOTIFY_CLIENT_SECRET || '').trim()
  );
  const current = configured ? await loadStoredLink(env) : null;
  return {
    configured,
    connected: Boolean(current?.refreshToken),
    displayName: current?.displayName || '',
    userId: current?.userId || '',
    redirectUri: getSpotifyRedirectUri(origin),
  };
}

export async function requestSpotifyToken(
  env: SpotifyEnv,
  formParams: Record<string, string>
): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}> {
  const clientId = (env.SPOTIFY_CLIENT_ID || '').trim();
  const clientSecret = (env.SPOTIFY_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) {
    throw new Error('伺服器尚未設定 Spotify 應用程式憑證');
  }
  const body = new URLSearchParams({
    ...formParams,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new Error(`Spotify 授權驗證失敗（HTTP ${res.status}）`);
  }

  return (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
}

export async function getValidUserAccessToken(
  env: SpotifyEnv
): Promise<StoredSpotifySession> {
  const current = await loadStoredLink(env);
  if (!current || !current.refreshToken) {
    throw new Error('主辦人尚未連結 Spotify 帳號');
  }

  if (current.accessToken && current.expiresAt > Date.now() + 120_000) {
    return current;
  }

  const refreshed = await requestSpotifyToken(env, {
    grant_type: 'refresh_token',
    refresh_token: current.refreshToken,
  });

  const updated: StoredSpotifySession = {
    ...current,
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token || current.refreshToken,
    expiresAt: Date.now() + Math.max(60, refreshed.expires_in - 60) * 1000,
    updatedAt: new Date().toISOString(),
  };
  await saveStoredLink(env, updated);
  return updated;
}

const STATE_KEY_PREFIX = 'spotify/oauth_state_';
const SPOTIFY_SCOPES = 'playlist-modify-public playlist-modify-private user-read-private';

function sanitizeAppBase(env: SpotifyEnv, rawReturnUrl: string): string {
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

function buildCallbackResponse(baseUrl: string, partyId: string, status: 'connected' | 'error'): Response {
  const qs = new URLSearchParams();
  if (partyId) qs.set('p', partyId);
  qs.set('spotify', status);
  const href = `${baseUrl}?${qs.toString()}`;
  return new Response(null, { status: 302, headers: { Location: href } });
}

export async function createSpotifyAuthUrl(
  env: SpotifyEnv,
  origin: string,
  returnUrl: string
): Promise<{ authUrl: string; redirectUri: string }> {
  const clientId = (env.SPOTIFY_CLIENT_ID || '').trim();
  if (!clientId) {
    throw new Error('伺服器尚未設定 Spotify 應用程式憑證');
  }
  const redirectUri = getSpotifyRedirectUri(origin);
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
    scope: SPOTIFY_SCOPES,
    redirect_uri: redirectUri,
    state,
    show_dialog: 'true',
  });

  return {
    authUrl: `https://accounts.spotify.com/authorize?${params.toString()}`,
    redirectUri,
  };
}

export async function handleSpotifyCallback(
  env: SpotifyEnv,
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
    const redirectUri = getSpotifyRedirectUri(url.origin);
    const tokenData = await requestSpotifyToken(env, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    });

    const profileRes = await fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profile = profileRes.ok
      ? ((await profileRes.json()) as { id?: string; display_name?: string })
      : {};

    await saveStoredLink(env, {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token || '',
      expiresAt: Date.now() + Math.max(60, tokenData.expires_in - 60) * 1000,
      displayName: profile.display_name || profile.id || 'Spotify 主辦人',
      userId: profile.id || '',
      updatedAt: new Date().toISOString(),
    });

    return buildCallbackResponse(baseUrl, partyId, 'connected');
  } catch {
    return buildCallbackResponse(baseUrl, partyId, 'error');
  }
}
