import {
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { db } from './firebase';
import type { Guest, Party, RsvpStatus } from '../types/party';

const RECENT_CACHE_KEY = 'partyo_recent_parties_v1';

export function generateId(prefix = ''): string {
  const random = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36).slice(-4);
  return prefix ? `${prefix}_${random}${time}` : `${random}${time}`;
}

/**
 * 合併主辦人維護的 guests 陣列與訪客登入自填的 rsvps map，供名單與費用分攤共用
 */
export function getAllGuests(party: Party): Guest[] {
  const byId = new Map<string, Guest>();
  for (const g of party.guests ?? []) {
    byId.set(g.id, g);
  }
  const rsvpEntries = Object.values(party.rsvps ?? {}).sort((a, b) =>
    a.updatedAt.localeCompare(b.updatedAt)
  );
  for (const g of rsvpEntries) {
    byId.set(g.id, g);
  }
  return Array.from(byId.values());
}

function readRecentMap(): Record<string, Party> {
  try {
    const raw = localStorage.getItem(RECENT_CACHE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, Party>;
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
  const updated: Party = {
    ...party,
    updatedAt: new Date().toISOString(),
  };

  const ref = doc(db, 'parties', updated.id);
  await setDoc(ref, updated, { merge: true });

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
  const entry: Guest = {
    ...guest,
    id: guest.uid,
    uid: guest.uid,
    updatedAt,
  };
  const ref = doc(db, 'parties', partyId);
  await updateDoc(ref, {
    [`rsvps.${guest.uid}`]: entry,
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
  const ref = doc(db, 'parties', party.id);

  if (party.rsvps && party.rsvps[guestId]) {
    const nextEntry: Guest = {
      ...party.rsvps[guestId],
      status: nextStatus,
      updatedAt,
    };
    await updateDoc(ref, {
      [`rsvps.${guestId}`]: nextEntry,
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

  const nextGuests = party.guests.map((g) =>
    g.id === guestId ? { ...g, status: nextStatus, updatedAt } : g
  );
  await updateDoc(ref, { guests: nextGuests, updatedAt });
  const nextParty: Party = { ...party, guests: nextGuests, updatedAt };
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
  const ref = doc(db, 'parties', party.id);

  if (party.rsvps && party.rsvps[guestId]) {
    await updateDoc(ref, {
      [`rsvps.${guestId}`]: deleteField(),
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

  const nextGuests = party.guests.filter((g) => g.id !== guestId);
  await updateDoc(ref, { guests: nextGuests, updatedAt });
  const nextParty: Party = { ...party, guests: nextGuests, updatedAt };
  const map = readRecentMap();
  map[party.id] = nextParty;
  writeRecentMap(map);
  return nextParty;
}

export async function fetchPartyOnce(partyId: string): Promise<Party | null> {
  const ref = doc(db, 'parties', partyId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;

  const data = snap.data() as Party;
  const map = readRecentMap();
  map[data.id] = data;
  writeRecentMap(map);
  return data;
}

export function subscribeParty(
  partyId: string,
  onData: (party: Party | null) => void,
  onError?: (err: Error) => void
): () => void {
  const ref = doc(db, 'parties', partyId);
  return onSnapshot(
    ref,
    (snap) => {
      if (snap.exists()) {
        const data = snap.data() as Party;
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

export function removeRecentParty(partyId: string): void {
  const map = readRecentMap();
  delete map[partyId];
  writeRecentMap(map);
}

export async function deleteParty(partyId: string): Promise<void> {
  const ref = doc(db, 'parties', partyId);
  await deleteDoc(ref);
  removeRecentParty(partyId);
}
