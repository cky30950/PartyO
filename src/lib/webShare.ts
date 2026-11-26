export type ShareOutcome = 'shared' | 'cancelled' | 'unsupported';

export function canNativeShare(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

export async function shareTextOrUrl(payload: {
  title?: string;
  text?: string;
  url?: string;
}): Promise<ShareOutcome> {
  if (!canNativeShare()) return 'unsupported';
  try {
    await navigator.share(payload);
    return 'shared';
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return 'cancelled';
    }
    return 'unsupported';
  }
}

export async function shareImageDataUrl(options: {
  dataUrl: string;
  fileName: string;
  title?: string;
  text?: string;
}): Promise<ShareOutcome> {
  if (!canNativeShare() || typeof navigator.canShare !== 'function') {
    return 'unsupported';
  }
  try {
    const res = await fetch(options.dataUrl);
    const blob = await res.blob();
    const mimeType = blob.type || 'image/png';
    const file = new File([blob], options.fileName, { type: mimeType });
    if (!navigator.canShare({ files: [file] })) {
      return 'unsupported';
    }
    await navigator.share({
      title: options.title,
      text: options.text,
      files: [file],
    });
    return 'shared';
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return 'cancelled';
    }
    return 'unsupported';
  }
}
