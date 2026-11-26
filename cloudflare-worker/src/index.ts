/// <reference types="@cloudflare/workers-types" />

export interface Env {
  PARTYO_BUCKET: R2Bucket;
  AI: Ai;
  FIREBASE_PROJECT_ID: string;
  ADMIN_EMAILS: string;
  WORKERS_AI_MODEL?: string;
  ALLOWED_ORIGIN?: string;
}

interface FirebaseJwtPayload {
  iss?: string;
  aud?: string;
  sub?: string;
  user_id?: string;
  email?: string;
  email_verified?: boolean;
  exp?: number;
  iat?: number;
}

interface JwkKey extends JsonWebKey {
  kid: string;
}

const FIREBASE_JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

let cachedJwks: { keys: JwkKey[]; expiresAt: number } | null = null;

function corsHeaders(env: Env, extra?: Record<string, string>): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-File-Name',
    'Access-Control-Expose-Headers': 'Content-Disposition, Content-Length, Content-Type',
    ...extra,
  };
}

function jsonResponse(
  env: Env,
  data: unknown,
  status = 200
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders(env, { 'Content-Type': 'application/json; charset=utf-8' }),
  });
}

function base64UrlToUint8Array(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((input.length + 3) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function getFirebaseJwks(): Promise<JwkKey[]> {
  if (cachedJwks && Date.now() < cachedJwks.expiresAt) {
    return cachedJwks.keys;
  }
  const res = await fetch(FIREBASE_JWKS_URL);
  if (!res.ok) throw new Error('無法取得 Firebase 公開金鑰');
  const json = (await res.json()) as { keys?: JwkKey[] };
  const keys = json.keys ?? [];
  cachedJwks = { keys, expiresAt: Date.now() + 60 * 60 * 1000 };
  return keys;
}

async function verifyFirebaseAuth(
  request: Request,
  env: Env
): Promise<{ uid: string; email: string; isAdmin: boolean }> {
  const authHeader = request.headers.get('Authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw new Error('缺少登入授權憑證，請先登入 Google 帳號');
  }
  const token = match[1].trim();
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('無效的登入憑證格式');
  }

  const header = JSON.parse(new TextDecoder().decode(base64UrlToUint8Array(parts[0]))) as {
    alg?: string;
    kid?: string;
  };
  const payload = JSON.parse(
    new TextDecoder().decode(base64UrlToUint8Array(parts[1]))
  ) as FirebaseJwtPayload;

  if (header.alg !== 'RS256' || !header.kid) {
    throw new Error('不支援的憑證簽章演算法');
  }

  const projectId = env.FIREBASE_PROJECT_ID || 'cheungec-ea477';
  const nowSec = Math.floor(Date.now() / 1000);
  if (
    payload.aud !== projectId ||
    payload.iss !== `https://securetoken.google.com/${projectId}` ||
    !payload.sub ||
    !payload.exp ||
    payload.exp <= nowSec
  ) {
    throw new Error('登入憑證已過期或與專案不符，請重新整理頁面');
  }

  const keys = await getFirebaseJwks();
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    throw new Error('找不到對應的驗證金鑰');
  }

  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );

  const signingInput = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const signature = base64UrlToUint8Array(parts[2]);
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    signature,
    signingInput
  );
  if (!valid) {
    throw new Error('登入憑證簽章驗證失敗');
  }

  const email = (payload.email || '').trim().toLowerCase();
  const adminSet = new Set(
    (env.ADMIN_EMAILS || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
  const isAdmin = Boolean(email && payload.email_verified && adminSet.has(email));

  return {
    uid: payload.sub,
    email,
    isAdmin,
  };
}

function sanitizeSegment(raw: string, fallback: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  return cleaned || fallback;
}

function inferExtension(fileName: string, contentType: string): string {
  const fromName = fileName.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (fromName && ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'gif', 'avif'].includes(fromName)) {
    return fromName === 'jpeg' ? 'jpg' : fromName;
  }
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('heic')) return 'heic';
  if (contentType.includes('heif')) return 'heif';
  if (contentType.includes('gif')) return 'gif';
  return 'jpg';
}

function buildFileUrl(origin: string, key: string): string {
  return `${origin}/api/files/${key.split('/').map(encodeURIComponent).join('/')}`;
}

async function handlePhotoUpload(request: Request, env: Env, url: URL): Promise<Response> {
  const user = await verifyFirebaseAuth(request, env);
  const partyId = sanitizeSegment(url.searchParams.get('partyId') || '', '');
  if (!partyId || partyId.length < 4) {
    return jsonResponse(env, { error: '缺少有效的 partyId' }, 400);
  }

  const kind = url.searchParams.get('kind') === 'thumb' ? 'thumb' : 'original';
  const photoId = sanitizeSegment(
    url.searchParams.get('photoId') || crypto.randomUUID().replace(/-/g, '').slice(0, 16),
    crypto.randomUUID().replace(/-/g, '').slice(0, 16)
  );
  const rawFileName =
    url.searchParams.get('fileName') ||
    request.headers.get('X-File-Name') ||
    `${photoId}.jpg`;
  const contentType = request.headers.get('Content-Type') || 'image/jpeg';

  if (!contentType.startsWith('image/')) {
    return jsonResponse(env, { error: '僅支援上傳圖片檔案' }, 400);
  }

  const body = await request.arrayBuffer();
  const maxBytes = kind === 'thumb' ? 2 * 1024 * 1024 : 30 * 1024 * 1024;
  if (body.byteLength === 0 || body.byteLength > maxBytes) {
    return jsonResponse(
      env,
      { error: `檔案大小超出限制（上限 ${Math.round(maxBytes / 1024 / 1024)}MB）` },
      413
    );
  }

  const ext = inferExtension(rawFileName, contentType);
  const key =
    kind === 'thumb'
      ? `albums/${partyId}/thumbs/${photoId}.jpg`
      : `albums/${partyId}/${photoId}.${ext}`;

  await env.PARTYO_BUCKET.put(key, body, {
    httpMetadata: {
      contentType,
      cacheControl: 'public, max-age=31536000, immutable',
    },
    customMetadata: {
      partyId,
      photoId,
      kind,
      fileName: rawFileName.slice(0, 180),
      uploadedByUid: user.uid,
      uploadedAt: new Date().toISOString(),
    },
  });

  return jsonResponse(env, {
    key,
    photoId,
    url: buildFileUrl(url.origin, key),
    size: body.byteLength,
    contentType,
  });
}

function parseJsonFromAiOutput(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if ('title' in obj || 'amount' in obj) return obj;
    if (typeof obj.response === 'string') return parseJsonFromAiOutput(obj.response);
    if (obj.response && typeof obj.response === 'object') {
      return obj.response as Record<string, unknown>;
    }
    if (Array.isArray(obj.choices)) {
      const first = obj.choices[0] as { message?: { content?: unknown } } | undefined;
      if (first?.message?.content) return parseJsonFromAiOutput(first.message.content);
    }
    return {};
  }
  if (typeof raw !== 'string') return {};
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as Record<string, unknown>;
      } catch {
        return {};
      }
    }
    return {};
  }
}

async function handleReceiptScan(request: Request, env: Env, url: URL): Promise<Response> {
  const user = await verifyFirebaseAuth(request, env);
  if (!user.isAdmin) {
    return jsonResponse(env, { error: '只有主辦人／管理員可使用 AI 掃單功能' }, 403);
  }
  if (!env.AI) {
    return jsonResponse(env, { error: 'Worker 尚未綁定 Cloudflare Workers AI' }, 500);
  }

  const partyId = sanitizeSegment(url.searchParams.get('partyId') || '', '');
  if (!partyId || partyId.length < 4) {
    return jsonResponse(env, { error: '缺少有效的 partyId' }, 400);
  }

  const contentType = request.headers.get('Content-Type') || 'image/jpeg';
  if (!contentType.startsWith('image/')) {
    return jsonResponse(env, { error: '請上傳收據圖片（JPG / PNG / WebP）' }, 400);
  }

  const rawFileName =
    url.searchParams.get('fileName') ||
    request.headers.get('X-File-Name') ||
    `receipt_${Date.now()}.jpg`;
  const body = await request.arrayBuffer();
  if (body.byteLength === 0 || body.byteLength > 20 * 1024 * 1024) {
    return jsonResponse(env, { error: '收據圖片大小需介於 1B 至 20MB 之間' }, 413);
  }

  const receiptId = `rcpt_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
  const ext = inferExtension(rawFileName, contentType);
  const receiptKey = `receipts/${partyId}/${receiptId}.${ext}`;

  // 1. 先將原版收據圖片存入 Cloudflare R2 供日後查閱
  await env.PARTYO_BUCKET.put(receiptKey, body, {
    httpMetadata: {
      contentType,
      cacheControl: 'public, max-age=31536000, immutable',
    },
    customMetadata: {
      partyId,
      receiptId,
      fileName: rawFileName.slice(0, 180),
      uploadedByUid: user.uid,
      uploadedAt: new Date().toISOString(),
    },
  });

  const receiptUrl = buildFileUrl(url.origin, receiptKey);

  // 2. 呼叫 Cloudflare Workers AI（香港直連無地區限制、免外部 API Key）
  const primaryModel = env.WORKERS_AI_MODEL || '@cf/meta/llama-4-scout-17b-16e-instruct';
  const fallbackModel = '@cf/mistralai/mistral-small-3.1-24b-instruct';
  const base64Image = arrayBufferToBase64(body);
  const dataUri = `data:${contentType};base64,${base64Image}`;

  const systemPrompt = [
    '你是一位香港聚會記帳助手。請仔細閱讀用戶上傳的單據／收據圖片，只輸出合法 JSON（不要附加解釋文字），欄位如下：',
    '- title (string)：簡短清楚的繁體中文開支名稱（例如商戶名稱＋簡短用途，如「譚仔三哥晚餐」、「百佳超市零食飲品」、「Party Room 場地費」）。',
    '- amount (number)：最終實付總金額（純數字，含加一服務費、扣除折扣後的實際總額；若有多個數字請取 Total / 合計 / 應付總額）。',
    '- category (string)：只能從 venue、food、drinks、transport、supplies、other 選一個。',
    '- summary (string)：1 句繁體中文簡短明細摘要（如主要菜式、有否加一服務費、日期，上限 80 字）。',
    '- currency (string)：幣別代碼（預設 HKD）。',
  ].join('\n');

  const jsonSchema = {
    type: 'object',
    properties: {
      title: { type: 'string' },
      amount: { type: 'number' },
      category: {
        type: 'string',
        enum: ['venue', 'food', 'drinks', 'transport', 'supplies', 'other'],
      },
      summary: { type: 'string' },
      currency: { type: 'string' },
    },
    required: ['title', 'amount', 'category', 'summary'],
  };

  const runVision = async (modelName: string) =>
    (env.AI.run as (model: string, input: Record<string, unknown>) => Promise<unknown>)(
      modelName,
      {
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: '請讀取這張收據並輸出 JSON。' },
              { type: 'image_url', image_url: { url: dataUri } },
            ],
          },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: jsonSchema,
        },
        temperature: 0.1,
        max_tokens: 512,
      }
    );

  let aiRaw: unknown;
  try {
    aiRaw = await runVision(primaryModel);
  } catch {
    try {
      aiRaw = await runVision(fallbackModel);
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'AI 模型呼叫失敗';
      return jsonResponse(
        env,
        {
          receiptKey,
          receiptUrl,
          error: `收據已存入 R2，但 Workers AI 辨識失敗：${detail.slice(0, 200)}`,
        },
        502
      );
    }
  }

  const rawParsed = parseJsonFromAiOutput(aiRaw);
  const parsed = {
    title: typeof rawParsed.title === 'string' ? rawParsed.title : '',
    amount:
      typeof rawParsed.amount === 'number'
        ? rawParsed.amount
        : Number(String(rawParsed.amount ?? '').replace(/[^0-9.]/g, '')),
    category: typeof rawParsed.category === 'string' ? rawParsed.category : 'food',
    summary: typeof rawParsed.summary === 'string' ? rawParsed.summary : '',
    currency: typeof rawParsed.currency === 'string' ? rawParsed.currency : 'HKD',
  };

  const allowedCategories = new Set(['venue', 'food', 'drinks', 'transport', 'supplies', 'other']);
  const safeCategory =
    parsed.category && allowedCategories.has(parsed.category) ? parsed.category : 'food';
  const safeAmount =
    typeof parsed.amount === 'number' && Number.isFinite(parsed.amount) && parsed.amount > 0
      ? Math.round(parsed.amount * 100) / 100
      : 0;

  return jsonResponse(env, {
    receiptKey,
    receiptUrl,
    ocr: {
      title: (parsed.title || '').trim(),
      amount: safeAmount,
      category: safeCategory,
      summary: (parsed.summary || '').trim(),
      currency: (parsed.currency || 'HKD').trim().toUpperCase(),
    },
  });
}

async function handleGetFile(env: Env, url: URL, key: string): Promise<Response> {
  const object = await env.PARTYO_BUCKET.get(key);
  if (!object) {
    return jsonResponse(env, { error: '找不到檔案' }, 404);
  }

  const headers = new Headers(corsHeaders(env));
  object.writeHttpMetadata(headers);
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/octet-stream');
  }
  headers.set('ETag', object.httpEtag);
  if (!headers.has('Cache-Control')) {
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  }

  if (url.searchParams.get('download') === '1') {
    const fileName =
      url.searchParams.get('filename') ||
      object.customMetadata?.fileName ||
      key.split('/').pop() ||
      'photo.jpg';
    const encoded = encodeURIComponent(fileName);
    headers.set('Content-Disposition', `attachment; filename*=UTF-8''${encoded}`);
  }

  return new Response(object.body, { headers });
}

async function handleDeleteFile(request: Request, env: Env, key: string): Promise<Response> {
  const user = await verifyFirebaseAuth(request, env);
  const head = await env.PARTYO_BUCKET.head(key);
  if (!head) {
    return jsonResponse(env, { ok: true, deleted: false });
  }
  const ownerUid = head.customMetadata?.uploadedByUid;
  if (!user.isAdmin && ownerUid !== user.uid) {
    return jsonResponse(env, { error: '無權限刪除此檔案' }, 403);
  }
  await env.PARTYO_BUCKET.delete(key);
  return jsonResponse(env, { ok: true, deleted: true });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }

    const url = new URL(request.url);
    const pathname = url.pathname;

    try {
      if (request.method === 'GET' && pathname === '/health') {
        return jsonResponse(env, {
          ok: true,
          hasBucket: Boolean(env.PARTYO_BUCKET),
          hasWorkersAi: Boolean(env.AI),
          model: env.WORKERS_AI_MODEL || '@cf/meta/llama-4-scout-17b-16e-instruct',
        });
      }

      if (request.method === 'POST' && pathname === '/api/photos/upload') {
        return await handlePhotoUpload(request, env, url);
      }

      if (request.method === 'POST' && pathname === '/api/receipts/scan') {
        return await handleReceiptScan(request, env, url);
      }

      if (pathname.startsWith('/api/files/')) {
        const key = pathname
          .slice('/api/files/'.length)
          .split('/')
          .map(decodeURIComponent)
          .join('/');
        if (!key || key.includes('..')) {
          return jsonResponse(env, { error: '無效的檔案路徑' }, 400);
        }
        if (request.method === 'GET') {
          return await handleGetFile(env, url, key);
        }
        if (request.method === 'DELETE') {
          return await handleDeleteFile(request, env, key);
        }
      }

      return jsonResponse(env, { error: 'Not Found' }, 404);
    } catch (err) {
      const message = err instanceof Error ? err.message : '伺服器內部錯誤';
      const status =
        message.includes('憑證') || message.includes('登入') ? 401 : 500;
      return jsonResponse(env, { error: message }, status);
    }
  },
};
