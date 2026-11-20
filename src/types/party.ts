export type RsvpStatus = 'going' | 'maybe' | 'declined';

export interface Guest {
  id: string;
  name: string;
  status: RsvpStatus;
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
  createdAt: string;
}

export type PaymentMethod = 'PayMe' | 'FPS' | 'Cash' | 'Other';

export interface SettlementPayment {
  key: string; // `${fromGuestId}__${toGuestId}`
  paid: boolean;
  method?: PaymentMethod;
  paidAt?: string;
}

export interface Party {
  id: string;
  title: string;
  description: string;
  startTime: string; // ISO string or YYYY-MM-DDTHH:mm local datetime
  endTime: string;
  location: string;
  address?: string;
  hostName: string;
  maxGuests?: number;
  currency: string;
  paymeLink?: string;
  fpsInfo?: string;
  guests: Guest[];
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

export interface Transfer {
  key: string;
  fromGuestId: string;
  fromName: string;
  toGuestId: string;
  toName: string;
  amount: number;
}
