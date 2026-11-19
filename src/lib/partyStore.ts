import { doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import type { Party } from '../types/party';

const RECENT_CACHE_KEY = 'partyo_recent_parties_v1';

export function generateId(prefix = ''): string {
  const random = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36).slice(-4);
  return prefix ? `${prefix}_${random}${time}` : `${random}${time}`;
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
