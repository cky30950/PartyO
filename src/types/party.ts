import type { AppTheme } from '../lib/themes';
export type { AppTheme };

export type RsvpStatus = 'going' | 'maybe' | 'declined';

export type ApprovalStatus = 'approved' | 'pending' | 'waitlist' | 'rejected';

export interface Guest {
  id: string;
  uid?: string;
  email?: string;
  name: string;
  isHost?: boolean;
  status: RsvpStatus;
  approvalStatus?: ApprovalStatus;
  identityOrIg?: string; // 審核用：參加者身份或 IG ID
  note?: string;
  updatedAt: string;
}

export type SplitType = 'equal' | 'custom_shares' | 'exact';

export type ExpenseCategory = 'venue' | 'food' | 'drinks' | 'transport' | 'supplies' | 'other';

export interface Expense {
  id: string;
  title: string;
  amount: number; // HKD (or selected currency), up to 2 decimal places
  paidByGuestId: string;
  splitType: SplitType;
  participantIds: string[];
  customShares?: Record<string, number>; // e.g., { guestId: 1.5 }
  exactAmounts?: Record<string, number>; // e.g., { guestId: 120 }
  category: ExpenseCategory;
  receiptUrl?: string; // Cloudflare R2 儲存的原版單據圖片網址
  receiptKey?: string; // Cloudflare R2 物件路徑
  receiptSummary?: string; // Gemini AI 辨識摘要
  createdAt: string;
}

export type PaymentMethod = 'PayMe' | 'FPS' | 'Cash' | 'Other';

export interface SettlementPayment {
  key: string; // `${fromGuestId}__${toGuestId}`
  paid: boolean;
  paidAmount?: number; // 記錄確認收款當下的金額，避免補記開支後誤判為已全額付款
  method?: PaymentMethod;
  paidAt?: string;
}

export interface Party {
  id: string;
  title: string;
  description: string;
  startTime: string; // ISO string or YYYY-MM-DDTHH:mm local datetime
  endTime?: string; // 選填，留空代表未指定結束時間
  location: string;
  address?: string;
  hostName: string;
  maxGuests?: number;
  theme?: AppTheme;
  announcement?: string;
  announcementUpdatedAt?: string;
  manuallyEnded?: boolean;
  currency: string;
  paymeLink?: string;
  paymeQrImage?: string;
  fpsInfo?: string;
  fpsQrImage?: string;
  spotifyPlaylistId?: string;
  spotifyPlaylistUrl?: string;
  spotifyPlaylistName?: string;
  guests: Guest[];
  rsvps?: Record<string, Guest>; // 以 Firebase Auth UID 為 key，訪客只能新增或更新自己的記錄
  expenses: Expense[];
  settlementPayments: Record<string, SettlementPayment>;
  createdAt: string;
  updatedAt: string;
}

export interface GuestBalance {
  guestId: string;
  guestName: string;
  paid: number;
  owed: number;
  net: number; // positive = should receive, negative = owes others
}

export interface HostPaymentProfile {
  paymeLink?: string;
  paymeQrImage?: string;
  fpsInfo?: string;
  fpsQrImage?: string;
  updatedAt?: string;
}

export interface Transfer {
  key: string;
  fromGuestId: string;
  fromName: string;
  toGuestId: string;
  toName: string;
  amount: number;
}

export interface PartyPhoto {
  id: string;
  partyId: string;
  originalKey: string;
  originalUrl: string;
  thumbKey?: string;
  thumbUrl?: string;
  fileName: string;
  contentType: string;
  size: number;
  width?: number;
  height?: number;
  uploadedByUid: string;
  uploadedByName: string;
  uploadedAt: string;
}

export interface PartySong {
  id: string;
  partyId: string;
  trackId: string;
  uri: string;
  name: string;
  artists: string;
  albumName?: string;
  albumImage?: string;
  durationMs?: number;
  externalUrl: string;
  requestedByUid: string;
  requestedByName: string;
  requestedAt: string;
  syncedToSpotify?: boolean;
}
