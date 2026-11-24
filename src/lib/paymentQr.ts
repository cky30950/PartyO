function tlv(id: string, value: string): string {
  return `${id}${String(value.length).padStart(2, '0')}${value}`;
}

function crc16Ccitt(str: string): string {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * 將香港轉數快電話、FPS ID 或電郵轉為香港金管局 HKQR (EMVCo) 標準字串，
 * 若已是 EMVCo 字串則原樣返回。
 */
export function buildFpsHkqrPayload(fpsInfo: string): string {
  const trimmed = fpsInfo.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('000201')) return trimmed;

  let proxySubtag: '02' | '03' | '04' | null = null;
  let proxyValue = '';

  const emailMatch = trimmed.match(/[^\s@]+@[^\s@]+\.[^\s@]+/);
  if (emailMatch) {
    proxySubtag = '04';
    proxyValue = emailMatch[0];
  } else {
    const digitsOnly = trimmed.replace(/[\s\-+()]/g, '');
    // 香港手機號碼（8 位，以 4/5/6/7/8/9 開頭，或前面帶 852）
    const hkPhoneMatch = digitsOnly.match(/^(?:852)?([4-9]\d{7})$/);
    if (hkPhoneMatch) {
      proxySubtag = '03';
      proxyValue = `+852-${hkPhoneMatch[1]}`;
    } else {
      // 轉數快識別碼 FPS ID（7 至 9 位數字）
      const fpsIdMatch = digitsOnly.match(/^(\d{7,9})$/);
      if (fpsIdMatch) {
        proxySubtag = '02';
        proxyValue = fpsIdMatch[1];
      }
    }
  }

  if (!proxySubtag || !proxyValue) {
    return trimmed;
  }

  const merchantAccount = tlv('00', 'hk.com.hkicl') + tlv(proxySubtag, proxyValue);
  const body =
    tlv('00', '01') +
    tlv('01', '11') +
    tlv('26', merchantAccount) +
    tlv('52', '0000') +
    tlv('53', '344') +
    tlv('58', 'HK') +
    tlv('59', 'NA') +
    tlv('60', 'HK') +
    '6304';

  return body + crc16Ccitt(body);
}

/**
 * 壓縮主辦人上傳的二維碼圖片至適合存入 Realtime Database 的尺寸（最大 480px）
 */
export function compressQrImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('讀取圖片失敗'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('無效的圖片格式'));
      img.onload = () => {
        const maxSide = 480;
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('瀏覽器不支援圖片處理'));
          return;
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.88));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}
