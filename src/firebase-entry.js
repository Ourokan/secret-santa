export { initializeApp } from "firebase/app";
export {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup,
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, signOut, updateProfile,
} from "firebase/auth";
export {
  getFirestore, doc, collection, getDoc, setDoc, updateDoc, deleteDoc,
  onSnapshot, query, where, writeBatch, serverTimestamp,
} from "firebase/firestore";
