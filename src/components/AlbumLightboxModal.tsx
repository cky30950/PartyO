import { useState } from 'react';
import type { User } from 'firebase/auth';
import { toast } from 'sonner';
import { Download, Share2, Trash2, X } from 'lucide-react';
import type { PartyPhoto } from '../types/party';
import { deletePartyPhoto, triggerSinglePhotoDownload } from '../lib/mediaApi';
import { shareImageDataUrl } from '../lib/webShare';

interface AlbumLightboxModalProps {
  partyTitle: string;
  photo: PartyPhoto;
  isAdmin: boolean;
  currentUser: User | null;
  mediaApiBase: string;
  onClose: () => void;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatUploadTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('zh-HK', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

export function AlbumLightboxModal({
  partyTitle,
  photo,
  isAdmin,
  currentUser,
  mediaApiBase,
  onClose,
}: AlbumLightboxModalProps) {
  const [sharingPhoto, setSharingPhoto] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const canDelete = Boolean(currentUser && (isAdmin || photo.uploadedByUid === currentUser.uid));

  async function handleNativeShare() {
    setSharingPhoto(true);
    try {
      const outcome = await shareImageDataUrl({
        dataUrl: photo.originalUrl,
        fileName: photo.fileName,
        title: `${partyTitle} 活動相片`,
      });
      if (outcome === 'shared') {
        toast.success('已開啟系統分享');
        return;
      }
      if (outcome === 'cancelled') return;
      triggerSinglePhotoDownload(photo);
      toast.success('裝置不支援直接分享圖片，已改為下載原圖');
    } catch {
      triggerSinglePhotoDownload(photo);
      toast.info('已改為直接下載原圖');
    } finally {
      setSharingPhoto(false);
    }
  }

  async function handleDelete() {
    if (!currentUser || !canDelete) return;
    const ok = window.confirm(`確定要刪除相片「${photo.fileName}」嗎？此操作無法復原。`);
    if (!ok) return;
    setDeleting(true);
    try {
      await deletePartyPhoto({ apiBase: mediaApiBase, photo, user: currentUser });
      toast.success('已刪除相片');
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '刪除失敗';
      toast.error(`刪除相片失敗：${msg}`);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-xs font-bold text-slate-900">{photo.fileName}</p>
            <p className="text-[11px] text-slate-500">
              {photo.uploadedByName} 上傳於 {formatUploadTime(photo.uploadedAt)} ·{' '}
              {formatBytes(photo.size)}
              {photo.width && photo.height ? ` · ${photo.width}×${photo.height}` : ''}
            </p>
          </div>
          <button
            type="button"
            aria-label="關閉預覽"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-1 items-center justify-center overflow-auto bg-slate-900/95 p-2">
          <img
            src={photo.originalUrl}
            alt={photo.fileName}
            className="max-h-[60vh] w-auto object-contain"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 p-3.5">
          <button
            type="button"
            onClick={() => {
              triggerSinglePhotoDownload(photo);
              toast.success('已開始下載原圖');
            }}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-slate-800"
          >
            <Download className="h-4 w-4" /> 下載原圖
          </button>

          <button
            type="button"
            disabled={sharingPhoto}
            onClick={handleNativeShare}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-brand-600 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
          >
            <Share2 className="h-4 w-4" />
            {sharingPhoto ? '準備中...' : '原生分享／存圖'}
          </button>

          {canDelete ? (
            <button
              type="button"
              disabled={deleting}
              onClick={handleDelete}
              aria-label="刪除相片"
              title="刪除相片"
              className="inline-flex items-center justify-center rounded-2xl bg-rose-50 px-3 py-2.5 text-xs font-semibold text-rose-600 transition hover:bg-rose-100 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
