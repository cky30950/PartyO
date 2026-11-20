import { useEffect, useRef, useState } from 'react';
import { Loader2, MapPin, Search, X } from 'lucide-react';
import { buildGoogleMapsUrl } from '../lib/calendar';
import { MapPickerModal } from './MapPickerModal';

const GOOGLE_PLACES_API_KEY =
  import.meta.env.VITE_GOOGLE_PLACES_API_KEY || 'AIzaSyDPIU1taJQKl2RIui9kT961AneTCvX0Hts';

export interface PlaceSuggestion {
  placeId: string;
  name: string;
  secondaryText: string;
}

interface PlaceAutocompleteProps {
  location: string;
  address: string;
  onChangeLocation: (value: string) => void;
  onChangeAddress: (value: string) => void;
}

interface GoogleAutocompleteResponse {
  suggestions?: Array<{
    placePrediction?: {
      placeId?: string;
      text?: { text?: string };
      structuredFormat?: {
        mainText?: { text?: string };
        secondaryText?: { text?: string };
      };
    };
  }>;
}

interface GooglePlaceDetailsResponse {
  formattedAddress?: string;
}

function createSessionToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

async function fetchGoogleAutocomplete(
  query: string,
  sessionToken: string,
  signal: AbortSignal
): Promise<PlaceSuggestion[]> {
  const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
    },
    body: JSON.stringify({
      input: query.trim(),
      includedRegionCodes: ['hk'],
      languageCode: 'zh-HK',
      sessionToken,
    }),
    signal,
  });

  if (!res.ok) {
    throw new Error(`Places API error (${res.status})`);
  }

  const data = (await res.json()) as GoogleAutocompleteResponse;
  return (data.suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter((p): p is NonNullable<typeof p> => Boolean(p?.placeId))
    .map((p) => {
      const name = p.structuredFormat?.mainText?.text || p.text?.text || '';
      const secondaryText = p.structuredFormat?.secondaryText?.text || p.text?.text || '';
      return {
        placeId: p.placeId!,
        name,
        secondaryText,
      };
    })
    .filter((item) => Boolean(item.name));
}

/**
 * 僅請求 Essentials 級別的 formattedAddress 欄位，保持在每月 10,000 次免費額度內
 */
async function fetchPlaceFormattedAddress(
  placeId: string,
  sessionToken: string
): Promise<string | null> {
  const params = new URLSearchParams({
    languageCode: 'zh-HK',
    sessionToken,
  });
  const res = await fetch(
    `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?${params.toString()}`,
    {
      headers: {
        'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
        'X-Goog-FieldMask': 'formattedAddress',
      },
    }
  );
  if (!res.ok) return null;
  const data = (await res.json()) as GooglePlaceDetailsResponse;
  return data.formattedAddress?.trim() || null;
}

export function PlaceAutocomplete({
  location,
  address,
  onChangeLocation,
  onChangeAddress,
}: PlaceAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [apiError, setApiError] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const [showMapPicker, setShowMapPicker] = useState(false);

  const skipNextFetchRef = useRef(false);
  const sessionTokenRef = useRef<string>(createSessionToken());
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (skipNextFetchRef.current) {
      skipNextFetchRef.current = false;
      return;
    }

    const q = location.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setOpen(false);
      setLoading(false);
      setApiError('');
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setApiError('');
      try {
        const results = await fetchGoogleAutocomplete(
          q,
          sessionTokenRef.current,
          controller.signal
        );
        setSuggestions(results);
        setActiveIndex(-1);
        setOpen(true);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setSuggestions([]);
          setApiError('暫時未能連線 Google 地點搜尋（可繼續手動輸入或使用地圖選點）');
          setOpen(true);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }, 350);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [location]);

  async function handleSelect(place: PlaceSuggestion) {
    skipNextFetchRef.current = true;
    onChangeLocation(place.name);
    onChangeAddress(place.secondaryText);
    setOpen(false);
    setSuggestions([]);

    const currentToken = sessionTokenRef.current;
    sessionTokenRef.current = createSessionToken();

    setLoadingDetail(true);
    try {
      const formatted = await fetchPlaceFormattedAddress(place.placeId, currentToken);
      if (formatted) {
        onChangeAddress(formatted);
      }
    } finally {
      setLoadingDetail(false);
    }
  }

  return (
    <div ref={containerRef} className="space-y-3 sm:col-span-2">
      <div className="relative">
        <label className="block text-xs font-semibold text-slate-700">
          地點 / 商舖名稱
          <span className="ml-1 font-normal text-slate-400">（Google 地圖即時搜尋）</span>
        </label>
        <div className="mt-1 flex gap-1.5">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={location}
              onFocus={() => {
                if (suggestions.length > 0) setOpen(true);
              }}
              onChange={(e) => onChangeLocation(e.target.value)}
              onKeyDown={(e) => {
                if (!open || suggestions.length === 0) return;
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setActiveIndex((prev) => (prev + 1) % suggestions.length);
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActiveIndex((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1));
                } else if (e.key === 'Enter' && activeIndex >= 0) {
                  e.preventDefault();
                  void handleSelect(suggestions[activeIndex]);
                } else if (e.key === 'Escape') {
                  setOpen(false);
                }
              }}
              placeholder="輸入餐廳、Party Room 或商場名稱（例如：朗豪坊、銅鑼灣）"
              className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-9 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
            {loading ? (
              <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-brand-500" />
            ) : location ? (
              <button
                type="button"
                aria-label="清除地點"
                onClick={() => {
                  skipNextFetchRef.current = true;
                  onChangeLocation('');
                  setSuggestions([]);
                  setOpen(false);
                  setApiError('');
                }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setShowMapPicker(true);
            }}
            className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-brand-300 hover:bg-rose-50 hover:text-brand-600"
          >
            <MapPin className="h-3.5 w-3.5 text-brand-600" />
            地圖選點
          </button>
        </div>

        {open && (
          <div className="absolute z-30 mt-1.5 max-h-64 w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white py-1.5 shadow-lg">
            {apiError ? (
              <div className="px-3.5 py-2.5 text-xs text-amber-700">
                {apiError}{' '}
                <a
                  href={buildGoogleMapsUrl(location)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-brand-600 underline"
                >
                  打開 Google 地圖
                </a>
              </div>
            ) : suggestions.length === 0 && !loading ? (
              <div className="px-3.5 py-2.5 text-xs text-slate-500">
                搵唔到相符嘅商舖或地方，你可以繼續手動輸入，或按右邊「地圖選點」。
              </div>
            ) : (
              suggestions.map((item, idx) => (
                <button
                  key={item.placeId}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    void handleSelect(item);
                  }}
                  className={`flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left transition ${
                    idx === activeIndex ? 'bg-rose-50' : 'hover:bg-slate-50'
                  }`}
                >
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">{item.name}</p>
                    <p className="truncate text-xs text-slate-500">{item.secondaryText}</p>
                  </div>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-700">
          詳細地址
          <span className="ml-1 font-normal text-slate-400">
            {loadingDetail ? '（正在帶入完整地址...）' : '（選擇商舖或地圖選點後自動填入）'}
          </span>
        </label>
        <input
          type="text"
          value={address}
          onChange={(e) => onChangeAddress(e.target.value)}
          placeholder="選擇上方地點或使用「地圖選點」後自動帶出，亦可手動修改"
          className="mt-1 w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        />
      </div>

      {showMapPicker && (
        <MapPickerModal
          initialQuery={location || address}
          onSelect={(picked) => {
            onChangeAddress(picked.address);
            if (!location.trim() && picked.name) {
              skipNextFetchRef.current = true;
              onChangeLocation(picked.name);
            }
          }}
          onClose={() => setShowMapPicker(false)}
        />
      )}
    </div>
  );
}
