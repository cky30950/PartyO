import { get, onValue, ref, remove, set, update } from 'firebase/database';
import { rtdb } from './firebase';
import type {
  AppTheme,
  ApprovalStatus,
  Expense,
  Guest,
  HostPaymentProfile,
  Party,
  RsvpStatus,
} from '../types/party';

const RECENT_CACHE_KEY = 'partyo_recent_parties_v1';
const HOST_PAYMENT_CACHE_KEY = 'partyo_host_payment_profile_v1';
const APP_THEME_CACHE_KEY = 'partyo_app_theme_v1';

export function generateId(prefix = ''): string {
  const random = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36).slice(-4);
  return prefix ? `${prefix}_${random}${time}` : `${random}${time}`;
}

/**
 * 遞迴移除物件中的 undefined 欄位，避免 Firebase Realtime Database 拒絕寫入
 */
function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) {
        out[k] = stripUndefined(v);
      }
    }
    return out as T;
  }
  return value;
}

function toArray<T>(val: unknown): T[] {
  if (Array.isArray(val)) return val.filter((item): item is T => item != null);
  if (val && typeof val === 'object') {
    return Object.values(val as Record<string, T>).filter((item): item is T => item != null);
  }
  return [];
}

/**
 * Realtime Database 會略過空陣列與空物件，讀取時統一補回預設欄位
 */
function normalizeParty(raw: Partial<Party> & { id?: string }, fallbackId = ''): Party {
  const expenses = toArray<Expense>(raw.expenses).map((exp) => ({
    ...exp,
    participantIds: toArray<string>(exp.participantIds),
  }));

  return {
    id: raw.id || fallbackId,
    title: raw.title ?? '',
    description: raw.description ?? '',
    startTime: raw.startTime ?? '',
    endTime: raw.endTime ?? '',
    location: raw.location ?? '',
    address: raw.address ?? '',
    hostName: raw.hostName ?? '',
    maxGuests: typeof raw.maxGuests === 'number' && raw.maxGuests > 0 ? raw.maxGuests : undefined,
    announcement: raw.announcement ?? '',
    announcementUpdatedAt: raw.announcementUpdatedAt ?? '',
    manuallyEnded: typeof raw.manuallyEnded === 'boolean' ? raw.manuallyEnded : undefined,
    currency: raw.currency ?? 'HK$',
    paymeLink: raw.paymeLink ?? '',
    paymeQrImage: raw.paymeQrImage ?? '',
    fpsInfo: raw.fpsInfo ?? '',
    fpsQrImage: raw.fpsQrImage ?? '',
    guests: toArray<Guest>(raw.guests),
    rsvps: raw.rsvps && typeof raw.rsvps === 'object' ? raw.rsvps : {},
    expenses,
    settlementPayments:
      raw.settlementPayments && typeof raw.settlementPayments === 'object'
        ? raw.settlementPayments
        : {},
    createdAt: raw.createdAt ?? '',
    updatedAt: raw.updatedAt ?? '',
  };
}

/**
 * 取得已通過審核的正式參加者名單（主辦人手動加入 + 已批准的訪客報名），供正式名單與費用分攤使用
 */
/**
 * 判斷該參加者是否為活動搞手（相容舊資料名稱結尾含「（搞手）」）
 */
export function isHostGuest(guest: Pick<Guest, 'isHost' | 'name'>): boolean {
  return Boolean(guest.isHost || guest.name.includes('（搞手）'));
}

export function getApprovedGuests(party: Party): Guest[] {
  const byId = new Map<string, Guest>();
  for (const g of party.guests ?? []) {
    byId.set(g.id, { ...g, approvalStatus: g.approvalStatus ?? 'approved' });
  }
  const rsvpEntries = Object.values(party.rsvps ?? {})
    .filter((g) => (g.approvalStatus ?? 'approved') === 'approved')
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  for (const g of rsvpEntries) {
    byId.set(g.id, g);
  }
  return Array.from(byId.values());
}

/**
 * 取得待主辦人審核的訪客報名名單
 */
export function getPendingRsvps(party: Party): Guest[] {
  return Object.values(party.rsvps ?? {})
    .filter((g) => g.approvalStatus === 'pending')
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
}

/**
 * 取得候補名單（依申請時間先後排序）
 */
export function getWaitlistRsvps(party: Party): Guest[] {
  return Object.values(party.rsvps ?? {})
    .filter((g) => g.approvalStatus === 'waitlist')
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
}

/**
 * 取得已被拒絕的訪客報名（僅供主辦人檢視或重新批准）
 */
export function getRejectedRsvps(party: Party): Guest[] {
  return Object.values(party.rsvps ?? {})
    .filter((g) => g.approvalStatus === 'rejected')
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
}

export function getAllGuests(party: Party): Guest[] {
  return getApprovedGuests(party);
}

function readRecentMap(): Record<string, Party> {
  try {
    const raw = localStorage.getItem(RECENT_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, Partial<Party>>;
    const normalized: Record<string, Party> = {};
    for (const [id, item] of Object.entries(parsed)) {
      if (item) normalized[id] = normalizeParty(item, id);
    }
    return normalized;
  } catch {
    return {};
  }
}

function writeRecentMap(map: Record<string, Party>): void {
  try {
    localStorage.setItem(RECENT_CACHE_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage quota errors
  }
}

export function listRecentParties(): Party[] {
  const map = readRecentMap();
  return Object.values(map).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function saveParty(party: Party): Promise<void> {
  const updated: Party = stripUndefined({
    ...party,
    updatedAt: new Date().toISOString(),
  });

  await set(ref(rtdb, `parties/${updated.id}`), updated);

  const map = readRecentMap();
  map[updated.id] = updated;
  writeRecentMap(map);
}

/**
 * 已登入 Google 的訪客新增或更新自己的報名記錄（只寫入 rsvps[uid] 與 updatedAt）
 */
export async function upsertSelfRsvp(partyId: string, guest: Guest): Promise<void> {
  if (!guest.uid) {
    throw new Error('缺少使用者 UID，無法更新報名狀態');
  }
  const updatedAt = new Date().toISOString();
  const entry: Guest = stripUndefined({
    ...guest,
    id: guest.uid,
    uid: guest.uid,
    approvalStatus: guest.approvalStatus ?? 'pending',
    updatedAt,
  });

  await update(ref(rtdb, `parties/${partyId}`), {
    [`rsvps/${guest.uid}`]: entry,
    updatedAt,
  });

  const map = readRecentMap();
  if (map[partyId]) {
    map[partyId] = {
      ...map[partyId],
      rsvps: {
        ...(map[partyId].rsvps ?? {}),
        [guest.uid]: entry,
      },
      updatedAt,
    };
    writeRecentMap(map);
  }
}

/**
 * 主辦人更新任一參加者的出席狀態（自動判斷屬於 rsvps 或 guests）
 */
export async function adminUpdateGuestStatus(
  party: Party,
  guestId: string,
  nextStatus: RsvpStatus
): Promise<Party> {
  const updatedAt = new Date().toISOString();

  if (party.rsvps && party.rsvps[guestId]) {
    const nextEntry: Guest = stripUndefined({
      ...party.rsvps[guestId],
      status: nextStatus,
      updatedAt,
    });
    await update(ref(rtdb, `parties/${party.id}`), {
      [`rsvps/${guestId}`]: nextEntry,
      updatedAt,
    });
    const nextParty: Party = {
      ...party,
      rsvps: { ...party.rsvps, [guestId]: nextEntry },
      updatedAt,
    };
    const map = readRecentMap();
    map[party.id] = nextParty;
    writeRecentMap(map);
    return nextParty;
  }

  const nextGuests = stripUndefined(
    party.guests.map((g) =>
      g.id === guestId ? { ...g, status: nextStatus, updatedAt } : g
    )
  );
  await update(ref(rtdb, `parties/${party.id}`), {
    guests: nextGuests,
    updatedAt,
  });
  const nextParty: Party = { ...party, guests: nextGuests, updatedAt };
  const map = readRecentMap();
  map[party.id] = nextParty;
  writeRecentMap(map);
  return nextParty;
}

/**
 * 主辦人審核訪客報名（批准或拒絕）
 */
export async function adminSetRsvpApproval(
  party: Party,
  guestId: string,
  approvalStatus: ApprovalStatus
): Promise<Party> {
  const existing = party.rsvps?.[guestId];
  if (!existing) return party;

  const updatedAt = new Date().toISOString();
  const nextEntry: Guest = stripUndefined({
    ...existing,
    approvalStatus,
    status: approvalStatus === 'approved' && existing.approvalStatus === 'waitlist' ? 'going' : existing.status,
    updatedAt,
  });
  await update(ref(rtdb, `parties/${party.id}`), {
    [`rsvps/${guestId}`]: nextEntry,
    updatedAt,
  });
  const nextParty: Party = {
    ...party,
    rsvps: { ...(party.rsvps ?? {}), [guestId]: nextEntry },
    updatedAt,
  };
  const map = readRecentMap();
  map[party.id] = nextParty;
  writeRecentMap(map);
  return nextParty;
}

/**
 * 主辦人移除任一參加者（自動判斷屬於 rsvps 或 guests）
 */
export async function adminRemoveGuest(party: Party, guestId: string): Promise<Party> {
  const updatedAt = new Date().toISOString();

  if (party.rsvps && party.rsvps[guestId]) {
    await update(ref(rtdb, `parties/${party.id}`), {
      [`rsvps/${guestId}`]: null,
      updatedAt,
    });
    const nextRsvps = { ...party.rsvps };
    delete nextRsvps[guestId];
    const nextParty: Party = { ...party, rsvps: nextRsvps, updatedAt };
    const map = readRecentMap();
    map[party.id] = nextParty;
    writeRecentMap(map);
    return nextParty;
  }

  const nextGuests = stripUndefined(party.guests.filter((g) => g.id !== guestId));
  await update(ref(rtdb, `parties/${party.id}`), {
    guests: nextGuests,
    updatedAt,
  });
  const nextParty: Party = { ...party, guests: nextGuests, updatedAt };
  const map = readRecentMap();
  map[party.id] = nextParty;
  writeRecentMap(map);
  return nextParty;
}

export async function fetchPartyOnce(partyId: string): Promise<Party | null> {
  const snap = await get(ref(rtdb, `parties/${partyId}`));
  if (!snap.exists()) return null;

  const data = normalizeParty(snap.val() as Partial<Party>, partyId);
  const map = readRecentMap();
  map[data.id] = data;
  writeRecentMap(map);
  return data;
}

/**
 * 即時監聽單一派對活動（Realtime Database WebSocket 推送）
 */
export function subscribeParty(
  partyId: string,
  onData: (party: Party | null) => void,
  onError?: (err: Error) => void
): () => void {
  const partyRef = ref(rtdb, `parties/${partyId}`);
  return onValue(
    partyRef,
    (snap) => {
      if (snap.exists()) {
        const data = normalizeParty(snap.val() as Partial<Party>, partyId);
        const map = readRecentMap();
        map[data.id] = data;
        writeRecentMap(map);
        onData(data);
      } else {
        onData(null);
      }
    },
    (err) => {
      onError?.(err);
    }
  );
}

/**
 * 主辦人首頁即時監聽雲端所有派對列表（跨裝置即時同步）
 */
export function subscribeAllParties(
  onData: (parties: Party[]) => void,
  onError?: (err: Error) => void
): () => void {
  const partiesRef = ref(rtdb, 'parties');
  return onValue(
    partiesRef,
    (snap) => {
      if (!snap.exists()) {
        writeRecentMap({});
        onData([]);
        return;
      }
      const rawMap = snap.val() as Record<string, Partial<Party>>;
      const normalizedMap: Record<string, Party> = {};
      for (const [id, item] of Object.entries(rawMap)) {
        if (item) normalizedMap[id] = normalizeParty(item, id);
      }
      writeRecentMap(normalizedMap);
      const sorted = Object.values(normalizedMap).sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt)
      );
      onData(sorted);
    },
    (err) => {
      onError?.(err);
    }
  );
}

export function removeRecentParty(partyId: string): void {
  const map = readRecentMap();
  delete map[partyId];
  writeRecentMap(map);
}

export async function deleteParty(partyId: string): Promise<void> {
  await remove(ref(rtdb, `parties/${partyId}`));
  removeRecentParty(partyId);
}

export function readCachedHostPaymentProfile(): HostPaymentProfile | null {
  try {
    const raw = localStorage.getItem(HOST_PAYMENT_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as HostPaymentProfile;
  } catch {
    return null;
  }
}

function writeCachedHostPaymentProfile(profile: HostPaymentProfile | null): void {
  try {
    if (!profile) {
      localStorage.removeItem(HOST_PAYMENT_CACHE_KEY);
    } else {
      localStorage.setItem(HOST_PAYMENT_CACHE_KEY, JSON.stringify(profile));
    }
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * 將主辦人常用收款資料（PayMe / 轉數快及二維碼）保存到雲端，供下次開新局自動套用
 */
export async function saveHostPaymentProfile(profile: HostPaymentProfile): Promise<HostPaymentProfile> {
  const cleaned: HostPaymentProfile = stripUndefined({
    paymeLink: profile.paymeLink?.trim() ?? '',
    paymeQrImage: profile.paymeQrImage ?? '',
    fpsInfo: profile.fpsInfo?.trim() ?? '',
    fpsQrImage: profile.fpsQrImage ?? '',
    updatedAt: new Date().toISOString(),
  });
  await set(ref(rtdb, 'adminConfig/paymentProfile'), cleaned);
  writeCachedHostPaymentProfile(cleaned);
  return cleaned;
}

/**
 * 即時監聽主辦人雲端預設收款資料
 */
export function subscribeHostPaymentProfile(
  onData: (profile: HostPaymentProfile | null) => void,
  onError?: (err: Error) => void
): () => void {
  const profileRef = ref(rtdb, 'adminConfig/paymentProfile');
  return onValue(
    profileRef,
    (snap) => {
      if (snap.exists()) {
        const data = snap.val() as HostPaymentProfile;
        writeCachedHostPaymentProfile(data);
        onData(data);
      } else {
        onData(null);
      }
    },
    (err) => {
      onError?.(err);
    }
  );
}

function isValidAppTheme(val: unknown): val is AppTheme {
  return val === 'tavern' || val === 'cozy' || val === 'jrpg';
}

export function readCachedAppTheme(): AppTheme {
  try {
    const raw = localStorage.getItem(APP_THEME_CACHE_KEY);
    return isValidAppTheme(raw) ? raw : 'tavern';
  } catch {
    return 'tavern';
  }
}

function writeCachedAppTheme(theme: AppTheme): void {
  try {
    localStorage.setItem(APP_THEME_CACHE_KEY, theme);
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * 主辦人切換全站主題並即時同步至所有使用者
 */
export async function saveAppTheme(theme: AppTheme): Promise<void> {
  writeCachedAppTheme(theme);
  await set(ref(rtdb, 'appSettings/theme'), theme);
}

/**
 * 全站即時監聽主題設定（所有使用者同步更新）
 */
export function subscribeAppTheme(
  onData: (theme: AppTheme) => void,
  onError?: (err: Error) => void
): () => void {
  const themeRef = ref(rtdb, 'appSettings/theme');
  return onValue(
    themeRef,
    (snap) => {
      const raw = snap.val();
      const theme: AppTheme = isValidAppTheme(raw) ? raw : 'tavern';
      writeCachedAppTheme(theme);
      onData(theme);
    },
    (err) => {
      onError?.(err);
    }
  );
}
