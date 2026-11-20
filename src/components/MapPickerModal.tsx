import { useEffect, useRef, useState } from 'react';
import { Check, Crosshair, Loader2, MapPin, X } from 'lucide-react';

interface MapPickerModalProps {
  initialQuery?: string;
  onSelect: (result: { name: string; address: string }) => void;
  onClose: () => void;
}

interface LeafletMap {
  setView: (coords: [number, number], zoom: number) => LeafletMap;
  on: (event: string, handler: (e: { latlng: { lat: number; lng: number } }) => void) => void;
  remove: () => void;
  invalidateSize: () => void;
}

interface LeafletMarker {
  setLatLng: (coords: [number, number]) => void;
  getLatLng: () => { lat: number; lng: number };
  on: (event: string, handler: () => void) => void;
}

interface LeafletGlobal {
  map: (el: HTMLElement, options?: Record<string, unknown>) => LeafletMap;
  tileLayer: (url: string, options?: Record<string, unknown>) => { addTo: (m: LeafletMap) => void };
  marker: (
    coords: [number, number],
    options?: Record<string, unknown>
  ) => LeafletMarker & { addTo: (m: LeafletMap) => LeafletMarker };
}

declare global {
  interface Window {
    L?: LeafletGlobal;
  }
}

const LEAFLET_CSS_ID = 'partyo-leaflet-css';
const LEAFLET_JS_ID = 'partyo-leaflet-js';

function loadLeaflet(): Promise<LeafletGlobal> {
  if (window.L) return Promise.resolve(window.L);

  if (!document.getElementById(LEAFLET_CSS_ID)) {
    const link = document.createElement('link');
    link.id = LEAFLET_CSS_ID;
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);
  }

  return new Promise((resolve, reject) => {
    const existing = document.getElementById(LEAFLET_JS_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => {
        if (window.L) resolve(window.L);
        else reject(new Error('Leaflet failed to load'));
      });
      existing.addEventListener('error', () => reject(new Error('Leaflet script error')));
      return;
    }

    const script = document.createElement('script');
    script.id = LEAFLET_JS_ID;
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.async = true;
    script.onload = () => {
      if (window.L) resolve(window.L);
      else reject(new Error('Leaflet unavailable'));
    };
    script.onerror = () => reject(new Error('無法載入地圖元件'));
    document.head.appendChild(script);
  });
}

async function reverseGeocode(lat: number, lng: number): Promise<{ name: string; address: string }> {
  const params = new URLSearchParams({
    format: 'jsonv2',
    lat: String(lat),
    lon: String(lng),
    'accept-language': 'zh-HK,zh,en',
  });
  const res = await fetch(`https://nominatim.openstreetmap.org/reverse?${params.toString()}`);
  if (!res.ok) {
    const fallback = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    return { name: '', address: fallback };
  }
  const data = (await res.json()) as {
    name?: string;
    display_name?: string;
  };
  const displayName = data.display_name?.trim() || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  const name = data.name?.trim() || displayName.split(',')[0]?.trim() || '';
  return { name, address: displayName };
}

async function geocodeInitialQuery(query: string): Promise<[number, number] | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;
  try {
    const params = new URLSearchParams({
      format: 'json',
      limit: '1',
      countrycodes: 'hk',
      q: trimmed,
    });
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`);
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ lat: string; lon: string }>;
    if (data[0]) {
      return [Number(data[0].lat), Number(data[0].lon)];
    }
  } catch {
    // Ignore initial geocode error
  }
  return null;
}

export function MapPickerModal({ initialQuery = '', onSelect, onClose }: MapPickerModalProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<LeafletMarker | null>(null);

  const [loadingMap, setLoadingMap] = useState(true);
  const [mapError, setMapError] = useState('');
  const [resolving, setResolving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [picked, setPicked] = useState<{ name: string; address: string } | null>(null);

  async function pickPoint(lat: number, lng: number, L?: LeafletGlobal) {
    const leaflet = L || window.L;
    if (mapRef.current && leaflet) {
      if (markerRef.current) {
        markerRef.current.setLatLng([lat, lng]);
      } else {
        const marker = leaflet.marker([lat, lng], { draggable: true }).addTo(mapRef.current);
        marker.on('dragend', () => {
          const pos = marker.getLatLng();
          void pickPoint(pos.lat, pos.lng);
        });
        markerRef.current = marker;
      }
    }

    setResolving(true);
    try {
      const result = await reverseGeocode(lat, lng);
      setPicked(result);
    } catch {
      setPicked({ name: '', address: `${lat.toFixed(5)}, ${lng.toFixed(5)}` });
    } finally {
      setResolving(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const L = await loadLeaflet();
        if (cancelled || !mapContainerRef.current) return;

        // 預設香港中心座標
        let center: [number, number] = [22.3193, 114.1694];
        let zoom = 13;

        if (initialQuery.trim()) {
          const found = await geocodeInitialQuery(initialQuery);
          if (found && !cancelled) {
            center = found;
            zoom = 16;
          }
        }

        const map = L.map(mapContainerRef.current, { zoomControl: true }).setView(center, zoom);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors',
          maxZoom: 19,
        }).addTo(map);

        map.on('click', (e) => {
          void pickPoint(e.latlng.lat, e.latlng.lng, L);
        });

        mapRef.current = map;
        setLoadingMap(false);
        window.setTimeout(() => map.invalidateSize(), 150);
      } catch (err) {
        if (!cancelled) {
          setMapError(err instanceof Error ? err.message : '無法載入地圖');
          setLoadingMap(false);
        }
      }
    }

    void init();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        markerRef.current = null;
      }
    };
  }, [initialQuery]);

  function handleLocateMe() {
    if (!navigator.geolocation || !mapRef.current) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        mapRef.current?.setView([latitude, longitude], 17);
        void pickPoint(latitude, longitude);
        setLocating(false);
      },
      () => {
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-3 backdrop-blur-xs sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="地圖選點"
    >
      <div className="flex h-[82vh] max-h-[680px] w-full max-w-xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-slate-200">
        {/* 頂部標題列 */}
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
              <MapPin className="h-4 w-4 text-brand-600" />
              地圖選點
            </h3>
            <p className="text-[11px] text-slate-500">
              點擊地圖任意位置（或拖曳標記）即可自動取得詳細地址
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleLocateMe}
              disabled={locating || loadingMap}
              title="定位到我目前位置"
              className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              {locating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Crosshair className="h-3.5 w-3.5 text-brand-600" />
              )}
              目前位置
            </button>
            <button
              type="button"
              aria-label="關閉地圖選點"
              onClick={onClose}
              className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* 地圖主區 */}
        <div className="relative flex-1 bg-slate-100">
          <div ref={mapContainerRef} className="h-full w-full" />
          {loadingMap && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-50/90 text-xs text-slate-600">
              <Loader2 className="mr-2 h-4 w-4 animate-spin text-brand-600" />
              載入地圖中...
            </div>
          )}
          {mapError && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-50 p-6 text-center text-xs text-rose-600">
              {mapError}
            </div>
          )}
        </div>

        {/* 底部地址預覽與確認 */}
        <div className="border-t border-slate-100 bg-white px-4 py-3">
          <div className="min-h-[38px]">
            {resolving ? (
              <p className="flex items-center gap-1.5 text-xs text-slate-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-600" />
                正在解析該位置地址...
              </p>
            ) : picked ? (
              <div>
                <p className="text-[11px] font-semibold text-brand-600">已選取地址：</p>
                <p className="line-clamp-2 text-xs text-slate-800">{picked.address}</p>
              </div>
            ) : (
              <p className="text-xs text-slate-400">請在地圖上點選一個地點</p>
            )}
          </div>

          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"
            >
              取消
            </button>
            <button
              type="button"
              disabled={!picked || resolving}
              onClick={() => {
                if (picked) {
                  onSelect(picked);
                  onClose();
                }
              }}
              className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:opacity-40"
            >
              <Check className="h-3.5 w-3.5" />
              確認填入地址
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
