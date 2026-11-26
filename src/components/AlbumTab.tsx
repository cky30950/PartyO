import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import type { User } from 'firebase/auth';
import { toast } from 'sonner';
import {
  Camera,
  Check,
  CheckSquare,
  Download,
  FolderArchive,
  Image as ImageIcon,
  LogIn,
  Settings2,
  Square,
  Upload,
} from 'lucide-react';
import type { Party, PartyPhoto } from '../types/party';
import {
  downloadPhotosAsZip,
  subscribePartyPhotos,
  triggerSinglePhotoDownload,
  uploadPartyPhoto,
} from '../lib/mediaApi';
import { AlbumLightboxModal } from './AlbumLightboxModal';
import { MediaApiConfigForm } from './MediaApiConfigForm';

interface AlbumTabProps {
  party: Party;
  isAdmin: boolean;
  currentUser: User | null;
  authBusy: boolean;
  mediaApiBase: string;
  onSignIn: () => Promise<void>;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AlbumTab({
  party,
  isAdmin,
  currentUser,
  authBusy,
  mediaApiBase,
  onSignIn,
}: AlbumTabProps) {
  const [photos, setPhotos] = useState<PartyPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [zippingProgress, setZippingProgress] = useState<{ done: number; total: number } | null>(
    null
  );
  const [previewPhoto, setPreviewPhoto] = useState<PartyPhoto | null>(null);
  const [showConfig, setShowConfig] = useState(false);

  useEffect(() => {
    setLoading(true);
    const unsub = subscribePartyPhotos(party.id, (list) => {
      setPhotos(list);
      setLoading(false);
      setSelectedIds((prev) => prev.filter((id) => list.some((p) => p.id === id)));
    });
    return () => unsub();
  }, [party.id]);

  const totalSize = useMemo(() => photos.reduce((sum, p) => sum + (p.size || 0), 0), [photos]);
  const selectedPhotos = useMemo(
    () => photos.filter((p) => selectedIds.includes(p.id)),
    [photos, selectedIds]
  );
  const selectedSize = useMemo(
    () => selectedPhotos.reduce((sum, p) => sum + (p.size || 0), 0),
    [selectedPhotos]
  );

  const safeZipPrefix =
    party.title.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 28) || 'partyo_album';

  async function handleUploadFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    if (!currentUser) {
      toast.error('請先登入 Google 帳號再上傳相片');
      return;
    }
    if (!mediaApiBase) {
      toast.error('主辦人尚未設定雲端相簿伺服器網址');
      return;
    }

    const uploaderName =
      party.rsvps?.[currentUser.uid]?.name ||
      currentUser.displayName ||
      currentUser.email?.split('@')[0] ||
      '參加者';

    setUploading(true);
    setUploadProgress({ done: 0, total: files.length });

    let successCount = 0;
    let failCount = 0;
    for (let i = 0; i < files.length; i++) {
      try {
        await uploadPartyPhoto({
          apiBase: mediaApiBase,
          partyId: party.id,
          file: files[i],
          user: currentUser,
          uploaderName,
        });
        successCount += 1;
      } catch (err) {
        failCount += 1;
        const msg = err instanceof Error ? err.message : '上傳失敗';
        if (i === 0) toast.error(`上傳失敗：${msg}`);
      } finally {
        setUploadProgress({ done: i + 1, total: files.length });
      }
    }

    setUploading(false);
    setUploadProgress(null);

    if (successCount > 0 && failCount === 0) {
      toast.success(`已成功上傳 ${successCount} 張原圖至活動相簿！`);
    } else if (successCount > 0) {
      toast.warning(`已上傳 ${successCount} 張原圖，另有 ${failCount} 張失敗`);
    }
  }

  function toggleSelect(photoId: string) {
    setSelectedIds((prev) =>
      prev.includes(photoId) ? prev.filter((id) => id !== photoId) : [...prev, photoId]
    );
  }

  async function handleDownloadBatch(targetPhotos: PartyPhoto[], label: string) {
    if (targetPhotos.length === 0 || zippingProgress) return;
    if (targetPhotos.length === 1) {
      triggerSinglePhotoDownload(targetPhotos[0]);
      toast.success(`已開始下載原圖「${targetPhotos[0].fileName}」`);
      return;
    }

    setZippingProgress({ done: 0, total: targetPhotos.length });
    try {
      await downloadPhotosAsZip(
        targetPhotos,
        `${safeZipPrefix}_${label}_${targetPhotos.length}photos.zip`,
        (done, total) => setZippingProgress({ done, total })
      );
      toast.success(`已打包並下載 ${targetPhotos.length} 張原圖 ZIP！`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '打包下載失敗';
      toast.error(`打包原圖失敗：${msg}`);
    } finally {
      setZippingProgress(null);
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
              <Camera className="h-4 w-4 text-brand-600" />
              活動共享原圖相簿
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              無壓縮原圖儲存，所有參加者可瀏覽、挑選或一次過下載全部原圖。
            </p>
          </div>
          {isAdmin ? (
            <button
              type="button"
              onClick={() => setShowConfig((v) => !v)}
              className="inline-flex items-center gap-1 rounded-xl bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-200"
            >
              <Settings2 className="h-3.5 w-3.5" />
              {mediaApiBase ? '相簿連線設定' : '設定相簿連線'}
            </button>
          ) : null}
        </div>

        {isAdmin && (showConfig || !mediaApiBase) ? (
          <MediaApiConfigForm
            mediaApiBase={mediaApiBase}
            onSaved={() => setShowConfig(false)}
          />
        ) : null}

        {!mediaApiBase && !isAdmin ? (
          <p className="mt-3 rounded-2xl bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800 ring-1 ring-amber-200">
            主辦人尚未啟用雲端原圖相簿，請稍後再試。
          </p>
        ) : null}

        {mediaApiBase ? (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {currentUser ? (
              <label
                className={`inline-flex cursor-pointer items-center justify-center gap-2 rounded-2xl bg-brand-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-700 ${
                  uploading ? 'pointer-events-none opacity-60' : ''
                }`}
              >
                <Upload className="h-4 w-4" />
                {uploading && uploadProgress
                  ? `正在上傳原圖 (${uploadProgress.done}/${uploadProgress.total})...`
                  : '上傳原圖相片（可一次多選）'}
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  disabled={uploading}
                  onChange={handleUploadFiles}
                  className="hidden"
                />
              </label>
            ) : (
              <button
                type="button"
                disabled={authBusy}
                onClick={onSignIn}
                className="inline-flex items-center gap-1.5 rounded-2xl bg-brand-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-60"
              >
                <LogIn className="h-4 w-4" />
                登入 Google 上傳原圖相片
              </button>
            )}

            {photos.length > 0 ? (
              <>
                <button
                  type="button"
                  disabled={Boolean(zippingProgress)}
                  onClick={() => handleDownloadBatch(photos, 'all')}
                  className="inline-flex items-center gap-1.5 rounded-2xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
                >
                  <FolderArchive className="h-4 w-4" />
                  {zippingProgress
                    ? `正在打包原圖 (${zippingProgress.done}/${zippingProgress.total})...`
                    : `一次過下載全部原圖（${photos.length} 張 · ${formatBytes(totalSize)}）`}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setSelectMode((v) => {
                      if (v) setSelectedIds([]);
                      return !v;
                    });
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-2xl px-3.5 py-2.5 text-xs font-semibold ring-1 transition ${
                    selectMode
                      ? 'bg-indigo-600 text-white ring-indigo-600'
                      : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <CheckSquare className="h-4 w-4" />
                  {selectMode ? '退出選擇' : '選擇相片下載'}
                </button>
              </>
            ) : null}
          </div>
        ) : null}

        {selectMode && photos.length > 0 ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-indigo-50/80 px-3.5 py-2.5 ring-1 ring-indigo-200">
            <div className="flex items-center gap-2 text-xs font-semibold text-indigo-900">
              <span>
                已選 {selectedIds.length}/{photos.length} 張
                {selectedSize > 0 ? `（${formatBytes(selectedSize)}）` : ''}
              </span>
              <button
                type="button"
                onClick={() =>
                  setSelectedIds(
                    selectedIds.length === photos.length ? [] : photos.map((p) => p.id)
                  )
                }
                className="rounded-lg bg-white px-2 py-0.5 text-[11px] font-semibold text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-100"
              >
                {selectedIds.length === photos.length ? '取消全選' : '全選全部'}
              </button>
            </div>
            <button
              type="button"
              disabled={selectedPhotos.length === 0 || Boolean(zippingProgress)}
              onClick={() => handleDownloadBatch(selectedPhotos, 'selected')}
              className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              {zippingProgress
                ? `打包中 (${zippingProgress.done}/${zippingProgress.total})...`
                : selectedPhotos.length === 1
                  ? '下載已選原圖（1 張）'
                  : `打包下載已選原圖（${selectedPhotos.length} 張 ZIP）`}
            </button>
          </div>
        ) : null}
      </section>

      <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
            <ImageIcon className="h-4 w-4 text-brand-600" />
            相簿原圖（{photos.length}）
          </h3>
          {photos.length > 0 ? (
            <span className="text-[11px] text-slate-400">
              {selectMode ? '點選相片以勾選下載' : '點擊相片可檢視大圖或下載原圖'}
            </span>
          ) : null}
        </div>

        {loading ? (
          <p className="mt-6 text-center text-xs text-slate-400">載入相簿中...</p>
        ) : photos.length === 0 ? (
          <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-8 text-center">
            <Camera className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-2 text-xs font-medium text-slate-500">
              暫時未有活動相片，成為第一個上傳聚會原圖的人吧！
            </p>
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {photos.map((photo) => {
              const isSelected = selectedIds.includes(photo.id);
              return (
                <div
                  key={photo.id}
                  onClick={() => {
                    if (selectMode) {
                      toggleSelect(photo.id);
                    } else {
                      setPreviewPhoto(photo);
                    }
                  }}
                  className={`group relative aspect-square cursor-pointer overflow-hidden rounded-2xl bg-slate-100 ring-2 transition ${
                    selectMode && isSelected
                      ? 'ring-indigo-600'
                      : 'ring-slate-200/70 hover:ring-brand-300'
                  }`}
                >
                  <img
                    src={photo.thumbUrl || photo.originalUrl}
                    alt={photo.fileName}
                    loading="lazy"
                    className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.03]"
                  />

                  {selectMode ? (
                    <span
                      className={`absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-lg shadow-sm ${
                        isSelected
                          ? 'bg-indigo-600 text-white'
                          : 'bg-white/90 text-slate-500 ring-1 ring-slate-300'
                      }`}
                    >
                      {isSelected ? <Check className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                    </span>
                  ) : null}

                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-900/75 via-slate-900/30 to-transparent px-2.5 pb-2 pt-6 text-white">
                    <p className="truncate text-[11px] font-semibold">{photo.uploadedByName}</p>
                    <p className="text-[10px] text-slate-200">{formatBytes(photo.size)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {previewPhoto ? (
        <AlbumLightboxModal
          partyTitle={party.title}
          photo={previewPhoto}
          isAdmin={isAdmin}
          currentUser={currentUser}
          mediaApiBase={mediaApiBase}
          onClose={() => setPreviewPhoto(null)}
        />
      ) : null}
    </div>
  );
}
