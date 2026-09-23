import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, GoogleAuthProvider } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';

// Cấu hình web Firebase (project salecontrol-4d533). Giá trị này được phép công khai.
const env = import.meta.env;
const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || 'AIzaSyAGFu6hfy65etIE24aWcW30zxQT6BDyuJ4',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || 'salecontrol-4d533.firebaseapp.com',
  projectId: env.VITE_FIREBASE_PROJECT_ID || 'salecontrol-4d533',
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || 'salecontrol-4d533.firebasestorage.app',
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || '261412749898',
  appId: env.VITE_FIREBASE_APP_ID || '1:261412749898:web:31c7bcdb0127329fe7dcb3',
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

if (env.VITE_USE_EMULATOR === '1') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

export const SUPER_ADMINS = (env.VITE_SUPER_ADMINS || 'giangle1502@gmail.com')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
