import { doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore';
import { db, isFirebaseConfigured } from './firebase';
import type { Party } from '../types/party';

const LOCAL_STORAGE_KEY = 'partyo_parties_v1';
const LOCAL_EVENT = 'partyo:local-update';

export function generateId(prefix = ''): string {
  const random = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36).slice(-4);
  return prefix ? `${prefix}_${random}${time}` : `${random}${time}`;
}

function readLocalMap(): Record<string, Party> {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, Party>;
  } catch {
    return {};
  }
}

function writeLocalMap(map: Record<string, Party>): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(map));
    window.dispatchEvent(new CustomEvent(LOCAL_EVENT));
  } catch {
    // Ignore storage quota errors
  }
}

export function listRecentParties(): Party[] {
  const map = readLocalMap();
  return Object.values(map).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function saveParty(party: Party): Promise<void> {
  const updated: Party = {
    ...party,
    updatedAt: new Date().toISOString(),
  };

  const map = readLocalMap();
  map[updated.id] = updated;
  writeLocalMap(map);

  if (isFirebaseConfigured && db) {
    const ref = doc(db, 'parties', updated.id);
    await setDoc(ref, updated, { merge: true });
  }
}

export async function fetchPartyOnce(partyId: string): Promise<Party | null> {
  if (isFirebaseConfigured && db) {
    const ref = doc(db, 'parties', partyId);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const data = snap.data() as Party;
      const map = readLocalMap();
      map[data.id] = data;
      writeLocalMap(map);
      return data;
    }
  }
  const map = readLocalMap();
  return map[partyId] ?? null;
}

export function subscribeParty(
  partyId: string,
  onData: (party: Party | null) => void,
  onError?: (err: Error) => void
): () => void {
  if (isFirebaseConfigured && db) {
    const ref = doc(db, 'parties', partyId);
    return onSnapshot(
      ref,
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as Party;
          const map = readLocalMap();
          map[data.id] = data;
          writeLocalMap(map);
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

  const emit = () => {
    const map = readLocalMap();
    onData(map[partyId] ?? null);
  };

  emit();

  const onStorage = (e: StorageEvent) => {
    if (e.key === LOCAL_STORAGE_KEY) emit();
  };
  const onLocal = () => emit();

  window.addEventListener('storage', onStorage);
  window.addEventListener(LOCAL_EVENT, onLocal);

  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(LOCAL_EVENT, onLocal);
  };
}

export function deleteLocalParty(partyId: string): void {
  const map = readLocalMap();
  delete map[partyId];
  writeLocalMap(map);
}

export function createDemoParty(): Party {
  const now = new Date();
  const nextSat = new Date(now);
  const daysUntilSat = (6 - now.getDay() + 7) % 7 || 7;
  nextSat.setDate(now.getDate() + daysUntilSat);
  const yyyy = nextSat.getFullYear();
  const mm = String(nextSat.getMonth() + 1).padStart(2, '0');
  const dd = String(nextSat.getDate()).padStart(2, '0');

  const g1 = 'g_host';
  const g2 = 'g_sam';
  const g3 = 'g_marco';
  const g4 = 'g_chloe';
  const g5 = 'g_ben';

  const isoNow = now.toISOString();

  return {
    id: generateId('party'),
    title: '週末天台 BBQ & Boardgame 派對',
    description: '帶輕鬆心情上嚟燒嘢食、飲返杯同玩桌遊！天台有冷氣室內房，唔怕落雨。',
    startTime: `${yyyy}-${mm}-${dd}T18:30`,
    endTime: `${yyyy}-${mm}-${dd}T23:00`,
    location: '市區天台派對房',
    hostName: 'Alex',
    maxGuests: 12,
    currency: 'HK$',
    paymeLink: '',
    fpsInfo: 'FPS 轉數快（見群組置頂）',
    guests: [
      { id: g1, name: 'Alex（搞手）', status: 'going', note: '負責訂場同買飲品', updatedAt: isoNow },
      { id: g2, name: 'Sam', status: 'going', note: '帶甜品上嚟', updatedAt: isoNow },
      { id: g3, name: 'Marco', status: 'going', note: '唔飲酒', updatedAt: isoNow },
      { id: g4, name: 'Chloe', status: 'going', note: '大約 8:30 遲啲到', updatedAt: isoNow },
      { id: g5, name: 'Ben', status: 'maybe', note: '睇下使唔使 OT', updatedAt: isoNow },
    ],
    expenses: [
      {
        id: 'exp_venue',
        title: '天台 Party Room 訂場',
        amount: 1600,
        paidByGuestId: g1,
        splitType: 'equal',
        participantIds: [g1, g2, g3, g4],
        category: 'venue',
        createdAt: isoNow,
      },
      {
        id: 'exp_bbq',
        title: 'BBQ 食材（和牛、海鮮、丸類）',
        amount: 980,
        paidByGuestId: g2,
        splitType: 'custom_shares',
        participantIds: [g1, g2, g3, g4],
        customShares: {
          [g1]: 1,
          [g2]: 1,
          [g3]: 1,
          [g4]: 0.5,
        },
        category: 'food',
        createdAt: isoNow,
      },
      {
        id: 'exp_drinks',
        title: '手工啤酒 & 紅酒（只計飲酒人士）',
        amount: 450,
        paidByGuestId: g1,
        splitType: 'equal',
        participantIds: [g1, g2, g4],
        category: 'drinks',
        createdAt: isoNow,
      },
    ],
    settlementPayments: {
      [`${g3}__${g1}`]: {
        key: `${g3}__${g1}`,
        paid: true,
        method: 'PayMe',
        paidAt: isoNow,
      },
    },
    createdAt: isoNow,
    updatedAt: isoNow,
  };
}
