import type { User } from 'firebase/auth';
import { onValue, ref, remove, set } from 'firebase/database';
import { rtdb } from './firebase';
import { generateId } from './partyStore';
import { buildZipBlob, type ZipEntryInput } from './zipBuilder';
import type { ExpenseCategory, PartyPhoto } from '../types/party';

const ENV_MEDIA_API_BASE = (
  import.meta.env.VITE_MEDIA_API_BASE || 'https://partyo-media-api.partyo.workers.dev'
)
  .trim()
  .replace(/\/+$/, '');

export function normalizeApiBase(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

/**
 * 監聽雲端儲存的 Cloudflare Worker 網址（/appSettings/mediaApiBase），
 * 若未設定則退回環境變數 VITE_MEDIA_API_BASE。
 */
export function subscribeMediaApiBase(onChange: (apiBase: string) => void): () => void {
  const apiRef = ref(rtdb, 'appSettings/mediaApiBase');
  return onValue(
    apiRef,
    (snap) => {
      const val = snap.val();
      const fromCloud = typeof val === 'string' ? normalizeApiBase(val) : '';
      onChange(fromCloud || ENV_MEDIA_API_BASE);
    },
    () => {
      onChange(ENV_MEDIA_API_BASE);
    }
  );
}

export async function saveMediaApiBase(rawUrl: string): Promise<void> {
  const normalized = normalizeApiBase(rawUrl);
  await set(ref(rtdb, 'appSettings/mediaApiBase'), normalized);
}

/**
 * 監聽指定活動的共享原圖相簿清單（由新到舊排序）
 */
export function subscribePartyPhotos(
  partyId: string,
  onChange: (photos: PartyPhoto[]) => void
): () => void {
  const photosRef = ref(rtdb, `partyPhotos/${partyId}`);
  return onValue(
    photosRef,
    (snap) => {
      const raw = snap.val() as Record<string, PartyPhoto> | null;
      if (!raw || typeof raw !== 'object') {
        onChange([]);
        return;
      }
      const list = Object.values(raw)
        .filter((item): item is PartyPhoto => Boolean(item && item.id && item.originalUrl))
        .sort((a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || ''));
      onChange(list);
    },
    () => {
      onChange([]);
    }
  );
}

/**
 * 嘗試於前端產生輕量預覽縮圖（最長邊 640px）並讀取原圖尺寸；
 * 若瀏覽器無法解碼（例如桌面端 HEIC），會安全略過並照常保留原圖上傳。
 */
async function createThumbnailIfSupported(file: File): Promise<{
  thumbBlob?: Blob;
  width?: number;
  height?: number;
}> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;
      const maxSide = 640;
      const scale = Math.min(1, maxSide / Math.max(width || 1, height || 1));
      const tw = Math.max(1, Math.round(width * scale));
      const th = Math.max(1, Math.round(height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = tw;
      canvas.height = th;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(objectUrl);
        resolve({ width, height });
        return;
      }
      ctx.drawImage(img, 0, 0, tw, th);
      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(objectUrl);
          resolve({ thumbBlob: blob ?? undefined, width, height });
        },
        'image/jpeg',
        0.82
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({});
    };
    img.src = objectUrl;
  });
}

export async function uploadPartyPhoto(params: {
  apiBase: string;
  partyId: string;
  file: File;
  user: User;
  uploaderName: string;
}): Promise<PartyPhoto> {
  const { apiBase, partyId, file, user, uploaderName } = params;
  const base = normalizeApiBase(apiBase);
  if (!base) {
    throw new Error('尚未設定媒體伺服器網址');
  }

  const idToken = await user.getIdToken();
  const photoId = generateId('ph');
  const contentType = file.type || 'image/jpeg';

  // 1. 先嘗試產生縮圖（不影響原圖）
  const { thumbBlob, width, height } = await createThumbnailIfSupported(file);

  // 2. 上傳原圖至 Cloudflare R2
  const origQuery = new URLSearchParams({
    partyId,
    photoId,
    kind: 'original',
    fileName: file.name || `${photoId}.jpg`,
  });
  const origRes = await fetch(`${base}/api/photos/upload?${origQuery.toString()}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': contentType,
    },
    body: file,
  });
  const origJson = (await origRes.json()) as {
    key?: string;
    url?: string;
    size?: number;
    contentType?: string;
    error?: string;
  };
  if (!origRes.ok || !origJson.key || !origJson.url) {
    throw new Error(origJson.error || `原圖上傳失敗（HTTP ${origRes.status}）`);
  }

  // 3. 若成功產生縮圖，亦上傳縮圖加速相簿瀏覽
  let thumbKey: string | undefined;
  let thumbUrl: string | undefined;
  if (thumbBlob) {
    try {
      const thumbQuery = new URLSearchParams({
        partyId,
        photoId,
        kind: 'thumb',
        fileName: `${photoId}_thumb.jpg`,
      });
      const thumbRes = await fetch(`${base}/api/photos/upload?${thumbQuery.toString()}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'image/jpeg',
        },
        body: thumbBlob,
      });
      if (thumbRes.ok) {
        const thumbJson = (await thumbRes.json()) as { key?: string; url?: string };
        thumbKey = thumbJson.key;
        thumbUrl = thumbJson.url;
      }
    } catch {
      // 縮圖失敗不影響原圖
    }
  }

  const record: PartyPhoto = {
    id: photoId,
    partyId,
    originalKey: origJson.key,
    originalUrl: origJson.url,
    ...(thumbKey ? { thumbKey } : {}),
    ...(thumbUrl ? { thumbUrl } : {}),
    fileName: file.name || `${photoId}.jpg`,
    contentType: origJson.contentType || contentType,
    size: origJson.size ?? file.size,
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
    uploadedByUid: user.uid,
    uploadedByName: uploaderName.trim() || user.displayName || user.email?.split('@')[0] || '參加者',
    uploadedAt: new Date().toISOString(),
  };

  await set(ref(rtdb, `partyPhotos/${partyId}/${photoId}`), record);
  return record;
}

export async function deletePartyPhoto(params: {
  apiBase: string;
  photo: PartyPhoto;
  user: User;
}): Promise<void> {
  const { apiBase, photo, user } = params;
  const base = normalizeApiBase(apiBase);
  if (base) {
    const idToken = await user.getIdToken();
    const keysToDelete = [photo.originalKey, photo.thumbKey].filter(
      (k): k is string => Boolean(k)
    );
    await Promise.allSettled(
      keysToDelete.map((key) =>
        fetch(`${base}/api/files/${key.split('/').map(encodeURIComponent).join('/')}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${idToken}` },
        })
      )
    );
  }
  await remove(ref(rtdb, `partyPhotos/${photo.partyId}/${photo.id}`));
}

export function buildDownloadUrl(originalUrl: string, fileName: string): string {
  const sep = originalUrl.includes('?') ? '&' : '?';
  return `${originalUrl}${sep}download=1&filename=${encodeURIComponent(fileName)}`;
}

/**
 * 單張下載原圖（透過帶 Content-Disposition: attachment 的 R2 URL）
 */
export function triggerSinglePhotoDownload(photo: PartyPhoto): void {
  const link = document.createElement('a');
  link.href = buildDownloadUrl(photo.originalUrl, photo.fileName);
  link.download = photo.fileName;
  link.rel = 'noopener noreferrer';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * 將多張或全部原圖打包成無損 ZIP 一次下載
 */
export async function downloadPhotosAsZip(
  photos: PartyPhoto[],
  zipFileName: string,
  onProgress?: (done: number, total: number) => void
): Promise<void> {
  if (photos.length === 0) return;

  const usedNames = new Map<string, number>();
  const entries: ZipEntryInput[] = [];
  let done = 0;

  for (const photo of photos) {
    const res = await fetch(photo.originalUrl);
    if (!res.ok) {
      throw new Error(`下載「${photo.fileName}」失敗（HTTP ${res.status}）`);
    }
    const buf = new Uint8Array(await res.arrayBuffer());

    // 避免重複檔名覆蓋
    const baseName = (photo.fileName || `${photo.id}.jpg`).replace(/[/\\:*?"<>|]/g, '_');
    const count = usedNames.get(baseName) ?? 0;
    usedNames.set(baseName, count + 1);
    let uniqueName = baseName;
    if (count > 0) {
      const dotIdx = baseName.lastIndexOf('.');
      uniqueName =
        dotIdx > 0
          ? `${baseName.slice(0, dotIdx)}_${count + 1}${baseName.slice(dotIdx)}`
          : `${baseName}_${count + 1}`;
    }

    entries.push({ name: uniqueName, data: buf });
    done += 1;
    onProgress?.(done, photos.length);
  }

  const zipBlob = buildZipBlob(entries);
  const blobUrl = URL.createObjectURL(zipBlob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = zipFileName.endsWith('.zip') ? zipFileName : `${zipFileName}.zip`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}

export interface ReceiptOcrResult {
  receiptKey: string;
  receiptUrl: string;
  ocr: {
    title: string;
    amount: number;
    category: ExpenseCategory;
    summary: string;
    currency: string;
  };
}

/**
 * 透過 Cloudflare Worker 將單據原圖存入 R2 並呼叫 Gemini API 自動辨識金額、項目與分類
 */
export async function scanReceiptWithGemini(params: {
  apiBase: string;
  partyId: string;
  file: File;
  user: User;
}): Promise<ReceiptOcrResult> {
  const { apiBase, partyId, file, user } = params;
  const base = normalizeApiBase(apiBase);
  if (!base) {
    throw new Error('尚未設定伺服器連線網址，請先於相簿設定連線網址');
  }

  const idToken = await user.getIdToken();
  const query = new URLSearchParams({
    partyId,
    fileName: file.name || `receipt_${Date.now()}.jpg`,
  });

  const res = await fetch(`${base}/api/receipts/scan?${query.toString()}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': file.type || 'image/jpeg',
    },
    body: file,
  });

  const json = (await res.json()) as Partial<ReceiptOcrResult> & { error?: string };
  if (!res.ok) {
    throw new Error(json.error || `掃單失敗（HTTP ${res.status}）`);
  }
  if (!json.receiptUrl || !json.receiptKey || !json.ocr) {
    throw new Error('伺服器回傳格式異常');
  }
  return json as ReceiptOcrResult;
}
