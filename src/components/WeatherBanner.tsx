import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Cloud,
  CloudLightning,
  CloudRain,
  CloudSun,
  Droplets,
  Sun,
} from 'lucide-react';
import { fetchPartyWeather, type PartyWeatherInfo } from '../lib/hkoWeather';

interface WeatherBannerProps {
  startTime: string;
  ended: boolean;
}

function formatYmdLabel(ymd: string): string {
  const m = Number(ymd.slice(4, 6));
  const d = Number(ymd.slice(6, 8));
  return `${m}月${d}日`;
}

function WeatherGlyph({ icon, text }: { icon: number | null; text: string }) {
  if (text.includes('雷') || icon === 65) {
    return <CloudLightning className="h-5 w-5 text-amber-500" />;
  }
  if (
    text.includes('雨') ||
    (icon !== null && ((icon >= 62 && icon <= 64) || (icon >= 53 && icon <= 54)))
  ) {
    return <CloudRain className="h-5 w-5 text-sky-600" />;
  }
  if (text.includes('陽光') || icon === 50 || icon === 51) {
    return icon === 50 ? (
      <Sun className="h-5 w-5 text-amber-500" />
    ) : (
      <CloudSun className="h-5 w-5 text-amber-500" />
    );
  }
  return <Cloud className="h-5 w-5 text-slate-500" />;
}

export function WeatherBanner({ startTime, ended }: WeatherBannerProps) {
  const [weather, setWeather] = useState<PartyWeatherInfo | null>(null);

  useEffect(() => {
    if (ended || !startTime) {
      setWeather(null);
      return;
    }
    let cancelled = false;
    fetchPartyWeather(startTime)
      .then((info) => {
        if (!cancelled) setWeather(info);
      })
      .catch(() => {
        if (!cancelled) setWeather(null);
      });
    return () => {
      cancelled = true;
    };
  }, [startTime, ended]);

  if (!weather) return null;

  const { forecast, warnings } = weather;
  const highRainRisk =
    forecast?.psr === '高' || forecast?.psr === '中高' || forecast?.psr === '中';

  return (
    <div className="mb-4 space-y-2">
      {/* 現正生效天氣警告（活動在 2 天內且有警告時顯示） */}
      {warnings.length > 0 ? (
        <div className="flex items-start gap-2.5 rounded-2xl bg-rose-50/95 px-4 py-3 text-xs text-rose-900 shadow-sm ring-1 ring-rose-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
          <div className="min-w-0">
            <p className="font-bold text-rose-800">香港天文台現正生效天氣警告</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {warnings.map((w) => (
                <span
                  key={`${w.code}-${w.type ?? ''}`}
                  className="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-0.5 text-[11px] font-semibold text-rose-800"
                >
                  {w.name}
                  {w.type && !w.name.includes(w.type) ? `（${w.type}）` : ''}
                </span>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {/* 活動當日九天天氣預報 */}
      {forecast ? (
        <div className="flex items-start justify-between gap-3 rounded-2xl bg-sky-50/80 px-4 py-3 shadow-sm ring-1 ring-sky-200/80">
          <div className="flex min-w-0 items-start gap-2.5">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-sky-100">
              <WeatherGlyph icon={forecast.icon} text={forecast.forecastWeather} />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-bold text-sky-950">
                  活動日天氣（{formatYmdLabel(forecast.forecastDate)} {forecast.week}）
                </span>
                {forecast.minTemp !== null && forecast.maxTemp !== null ? (
                  <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-sky-800 ring-1 ring-sky-200/80">
                    {forecast.minTemp}–{forecast.maxTemp}°C
                  </span>
                ) : null}
                {forecast.psr ? (
                  <span
                    className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      highRainRisk
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-sky-100/80 text-sky-700'
                    }`}
                  >
                    <Droplets className="h-3 w-3" /> 降雨機率：{forecast.psr}
                  </span>
                ) : null}
              </div>
              {forecast.forecastWeather ? (
                <p className="mt-1 text-xs leading-relaxed text-sky-900/90">
                  {forecast.forecastWeather}
                </p>
              ) : null}
              <p className="mt-0.5 text-[10px] text-sky-700/70">
                資料來源：香港天文台九天天氣預報
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
