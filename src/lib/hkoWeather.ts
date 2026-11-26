export interface HkoForecastDay {
  forecastDate: string; // YYYYMMDD
  week: string;
  forecastWind: string;
  forecastWeather: string;
  minTemp: number | null;
  maxTemp: number | null;
  minRh: number | null;
  maxRh: number | null;
  icon: number | null;
  psr: string; // 降雨機率：低 / 中低 / 中 / 中高 / 高
}

export interface HkoWarningItem {
  code: string;
  name: string;
  type?: string;
  actionCode?: string;
  issueTime?: string;
}

export interface PartyWeatherInfo {
  forecast: HkoForecastDay | null;
  warnings: HkoWarningItem[];
  updateTime?: string;
}

interface RawHkoFnd {
  weatherForecast?: Array<{
    forecastDate?: string;
    week?: string;
    forecastWind?: string;
    forecastWeather?: string;
    forecastMaxtemp?: { value?: number };
    forecastMintemp?: { value?: number };
    forecastMaxrh?: { value?: number };
    forecastMinrh?: { value?: number };
    ForecastIcon?: number;
    PSR?: string;
  }>;
  updateTime?: string;
}

interface RawHkoWarningEntry {
  name?: string;
  code?: string;
  type?: string;
  actionCode?: string;
  issueTime?: string;
}

const HKO_FND_URL =
  'https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=fnd&lang=tc';
const HKO_WARNSUM_URL =
  'https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=warnsum&lang=tc';

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 分鐘快取

let cachedFnd: { data: HkoForecastDay[]; updateTime?: string; fetchedAt: number } | null = null;
let cachedWarnings: { data: HkoWarningItem[]; fetchedAt: number } | null = null;

/**
 * 將活動開始時間轉為香港時區的 YYYYMMDD 字串
 */
export function getHkDateYmd(startTime: string): string | null {
  if (!startTime) return null;
  const localMatch = startTime.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (localMatch) {
    return `${localMatch[1]}${localMatch[2]}${localMatch[3]}`;
  }
  const d = new Date(startTime);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
  return parts.replace(/-/g, '');
}

/**
 * 計算活動距離今天（香港日期）的天數差（0 = 今日，1 = 明日）
 */
export function getDaysFromTodayHk(targetYmd: string): number {
  const todayYmd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(new Date())
    .replace(/-/g, '');

  const parseUtcMid = (ymd: string) =>
    Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8)));

  return Math.round((parseUtcMid(targetYmd) - parseUtcMid(todayYmd)) / (24 * 60 * 60 * 1000));
}

async function fetchHkoNineDayForecast(): Promise<{
  data: HkoForecastDay[];
  updateTime?: string;
}> {
  if (cachedFnd && Date.now() - cachedFnd.fetchedAt < CACHE_TTL_MS) {
    return { data: cachedFnd.data, updateTime: cachedFnd.updateTime };
  }
  const res = await fetch(HKO_FND_URL);
  if (!res.ok) throw new Error(`HKO fnd HTTP ${res.status}`);
  const json = (await res.json()) as RawHkoFnd;
  const list: HkoForecastDay[] = (json.weatherForecast ?? [])
    .filter((item): item is NonNullable<typeof item> & { forecastDate: string } =>
      Boolean(item?.forecastDate)
    )
    .map((item) => ({
      forecastDate: item.forecastDate,
      week: item.week ?? '',
      forecastWind: item.forecastWind ?? '',
      forecastWeather: item.forecastWeather ?? '',
      minTemp: typeof item.forecastMintemp?.value === 'number' ? item.forecastMintemp.value : null,
      maxTemp: typeof item.forecastMaxtemp?.value === 'number' ? item.forecastMaxtemp.value : null,
      minRh: typeof item.forecastMinrh?.value === 'number' ? item.forecastMinrh.value : null,
      maxRh: typeof item.forecastMaxrh?.value === 'number' ? item.forecastMaxrh.value : null,
      icon: typeof item.ForecastIcon === 'number' ? item.ForecastIcon : null,
      psr: item.PSR ?? '',
    }));

  cachedFnd = { data: list, updateTime: json.updateTime, fetchedAt: Date.now() };
  return { data: list, updateTime: json.updateTime };
}

async function fetchHkoWarnings(): Promise<HkoWarningItem[]> {
  if (cachedWarnings && Date.now() - cachedWarnings.fetchedAt < CACHE_TTL_MS) {
    return cachedWarnings.data;
  }
  const res = await fetch(HKO_WARNSUM_URL);
  if (!res.ok) throw new Error(`HKO warnsum HTTP ${res.status}`);
  const json = (await res.json()) as Record<string, RawHkoWarningEntry>;
  const warnings: HkoWarningItem[] = Object.entries(json ?? {})
    .map(([key, entry]) => ({
      code: entry?.code || key,
      name: entry?.name || key,
      type: entry?.type,
      actionCode: entry?.actionCode,
      issueTime: entry?.issueTime,
    }))
    .filter((w) => w.actionCode !== 'CANCEL' && Boolean(w.name));

  cachedWarnings = { data: warnings, fetchedAt: Date.now() };
  return warnings;
}

/**
 * 取得活動日期對應的香港天文台天氣預報與現正生效天氣警告（活動在 9 日內才查詢）
 */
export async function fetchPartyWeather(startTime: string): Promise<PartyWeatherInfo | null> {
  const targetYmd = getHkDateYmd(startTime);
  if (!targetYmd) return null;

  const daysDiff = getDaysFromTodayHk(targetYmd);
  // 僅在活動為今天至未來 9 天內顯示天氣預報
  if (daysDiff < 0 || daysDiff > 9) {
    return null;
  }

  const shouldCheckWarnings = daysDiff <= 2;

  const [fndResult, warningsResult] = await Promise.allSettled([
    fetchHkoNineDayForecast(),
    shouldCheckWarnings ? fetchHkoWarnings() : Promise.resolve([]),
  ]);

  const fndData = fndResult.status === 'fulfilled' ? fndResult.value : null;
  const warnings = warningsResult.status === 'fulfilled' ? warningsResult.value : [];
  const forecast = fndData?.data.find((d) => d.forecastDate === targetYmd) ?? null;

  if (!forecast && warnings.length === 0) {
    return null;
  }

  return {
    forecast,
    warnings,
    updateTime: fndData?.updateTime,
  };
}
