import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

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

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
