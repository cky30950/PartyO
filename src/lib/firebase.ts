import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyBtUcrBYiE4B1O4xkvIqwxM52Hrh-i6pL8',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'cheungec-ea477.firebaseapp.com',
  databaseURL:
    import.meta.env.VITE_FIREBASE_DATABASE_URL ||
    'https://cheungec-ea477-default-rtdb.firebaseio.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'cheungec-ea477',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'cheungec-ea477.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '986510230799',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:986510230799:web:f603e67b605e71294f2a7a',
};

export const ADMIN_EMAIL = (
  import.meta.env.VITE_ADMIN_EMAIL || 'cky30950@gmail.com'
).trim().toLowerCase();

export const OWNER_EMAIL = ADMIN_EMAIL;

export const app = initializeApp(firebaseConfig);
export const rtdb = getDatabase(app);
export const auth = getAuth(app);

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export function encodeEmailKey(email: string): string {
  return email.trim().toLowerCase().replace(/\./g, ',');
}

export function decodeEmailKey(key: string): string {
  return key.replace(/,/g, '.');
}

export function isOwnerUser(user: User | null): boolean {
  return Boolean(user?.email && user.email.trim().toLowerCase() === OWNER_EMAIL);
}

export function isAdminUser(user: User | null): boolean {
  return isOwnerUser(user);
}

export async function signInWithGoogle(): Promise<User> {
  const cred = await signInWithPopup(auth, googleProvider);
  return cred.user;
}

export async function signOutUser(): Promise<void> {
  await signOut(auth);
}
