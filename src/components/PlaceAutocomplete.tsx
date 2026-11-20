import { useEffect, useRef, useState } from 'react';
import { Loader2, MapPin, Search, X } from 'lucide-react';
import { buildGoogleMapsUrl } from '../lib/calendar';

export interface PlaceSuggestion {
  id: string;
  name: string;
  address: string;
}

interface PlaceAutocompleteProps {
  location: string;
  address: string;
  onChangeLocation: (value: string) => void;
  onChangeAddress: (value: string) => void;
}

interface NominatimItem {
  place_id: number;
  name?: string;
  display_name: string;
}

async function searchPlaces(query: string, signal: AbortSignal): Promise<PlaceSuggestion[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const params = new URLSearchParams({
    format: 'json',
    addressdetails: '1',
    limit: '6',
    countrycodes: 'hk',
    'accept-language': 'zh-HK,zh,en',
    q: trimmed,
  });

  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
    signal,
  });
  if (!res.ok) return [];
  const data = (await res.json()) as NominatimItem[];

  return data.map((item) => {
    const parts = item.display_name.split(',').map((s) => s.trim());
    const name = item.name || parts[0] || trimmed;
    const address =
      parts[0] === name && parts.length > 1 ? parts.slice(1).join(', ') : item.display_name;
    return {
      id: String(item.place_id),
      name,
      address,
    };
  });
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
  const [activeIndex, setActiveIndex] = useState(-1);
  const skipNextFetchRef = useRef(false);
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
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const results = await searchPlaces(q, controller.signal);
        setSuggestions(results);
        setActiveIndex(-1);
        setOpen(true);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setSuggestions([]);
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

  function handleSelect(place: PlaceSuggestion) {
    skipNextFetchRef.current = true;
    onChangeLocation(place.name);
    onChangeAddress(place.address);
    setOpen(false);
    setSuggestions([]);
  }

  const mapQuery = [location.trim(), address.trim()].filter(Boolean).join(' ');

  return (
    <div ref={containerRef} className="space-y-3 sm:col-span-2">
      <div className="relative">
        <label className="block text-xs font-semibold text-slate-700">
          地點 / 商舖名稱
        </label>
        <div className="relative mt-1">
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
                handleSelect(suggestions[activeIndex]);
              } else if (e.key === 'Escape') {
                setOpen(false);
              }
            }}
            placeholder="輸入商舖或地方名稱（例如：朗豪坊、時代廣場、K11）"
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
              }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>

        {open && (
          <div className="absolute z-30 mt-1.5 max-h-64 w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white py-1.5 shadow-lg">
            {suggestions.length === 0 && !loading ? (
              <div className="px-3.5 py-2.5 text-xs text-slate-500">
                搵唔到相符嘅商舖或地方，你可以繼續手動輸入，或{' '}
                <a
                  href={buildGoogleMapsUrl(location)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-brand-600 underline"
                >
                  用 Google 地圖搜尋
                </a>
              </div>
            ) : (
              suggestions.map((item, idx) => (
                <button
                  key={item.id}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleSelect(item);
                  }}
                  className={`flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left transition ${
                    idx === activeIndex ? 'bg-rose-50' : 'hover:bg-slate-50'
                  }`}
                >
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">{item.name}</p>
                    <p className="truncate text-xs text-slate-500">{item.address}</p>
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
          <span className="ml-1 font-normal text-slate-400">（選擇商舖後自動填入）</span>
        </label>
        <div className="mt-1 flex gap-1.5">
          <input
            type="text"
            value={address}
            onChange={(e) => onChangeAddress(e.target.value)}
            placeholder="選擇上方地點後自動帶出，或手動輸入詳細地址"
            className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />
          <a
            href={buildGoogleMapsUrl(mapQuery)}
            target="_blank"
            rel="noopener noreferrer"
            title={mapQuery ? `在 Google 地圖查看「${mapQuery}」` : '打開 Google 地圖'}
            className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-brand-300 hover:bg-rose-50 hover:text-brand-600"
          >
            <MapPin className="h-3.5 w-3.5 text-brand-600" />
            Google 地圖
          </a>
        </div>
      </div>
    </div>
  );
}
