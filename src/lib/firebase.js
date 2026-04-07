import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyCVV7vojIXo3AMhreCyq4Y6qd0OTtlSh84",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "rondas-juego.firebaseapp.com",
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || "https://rondas-juego-default-rtdb.firebaseio.com/",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "rondas-juego",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "rondas-juego.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "783172820256",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:783172820256:web:24d1c1e6e0b0ed64ce8b45",
};

let app = null;
let db = null;
let firebaseInitError = "";

try {
  app = initializeApp(firebaseConfig);
  db = getDatabase(app);
} catch (error) {
  firebaseInitError = error instanceof Error ? error.message : "No se pudo inicializar Firebase.";
  console.error(error);
}

export { app, db, firebaseInitError };
