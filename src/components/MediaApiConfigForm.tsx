import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { normalizeApiBase, saveMediaApiBase } from '../lib/mediaApi';

interface MediaApiConfigFormProps {
  mediaApiBase: string;
  onSaved: () => void;
}

export function MediaApiConfigForm({ mediaApiBase, onSaved }: MediaApiConfigFormProps) {
  const [apiInput, setApiInput] = useState(mediaApiBase);
  const [savingApi, setSavingApi] = useState(false);

  useEffect(() => {
    setApiInput(mediaApiBase);
  }, [mediaApiBase]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const normalized = normalizeApiBase(apiInput);
    if (normalized && !normalized.startsWith('https://') && !normalized.startsWith('http://')) {
      toast.error('請輸入完整的 https:// 伺服器網址');
      return;
    }
    setSavingApi(true);
    try {
      await saveMediaApiBase(normalized);
      onSaved();
      toast.success(normalized ? '已儲存雲端媒體伺服器網址' : '已清除伺服器網址');
    } catch (err) {
      const detail = err instanceof Error ? err.message : '儲存失敗';
      toast.error(`設定失敗：${detail}`);
    } finally {
      setSavingApi(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-3 space-y-2.5 rounded-2xl bg-slate-50 p-3.5 ring-1 ring-slate-200/80"
    >
      <label className="block text-xs font-bold text-slate-700">
        雲端相簿與 AI 掃單伺服器網址
      </label>
      <p className="text-[11px] leading-relaxed text-slate-500">
        原圖相簿與 AI 掃單會共用此後端連線網址。
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="url"
          value={apiInput}
          onChange={(e) => setApiInput(e.target.value)}
          placeholder="貼上伺服器網址"
          className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-brand-500"
        />
        <button
          type="submit"
          disabled={savingApi}
          className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
        >
          {savingApi ? '儲存中...' : '儲存連線網址'}
        </button>
      </div>
    </form>
  );
}
