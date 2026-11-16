// In-memory stand-in for the Firebase SDK, for UI tests only (no security rules).
const store = new Map();
const listeners = new Set();
let authCbs = [], current = null;
const clone = (o) => JSON.parse(JSON.stringify(o));
const notify = () => queueMicrotask(() => listeners.forEach((l) => l.fire()));
export const initializeApp = () => ({});
export const getAuth = () => ({});
export const getFirestore = () => ({});
export const onAuthStateChanged = (_a, cb) => { authCbs.push(cb); setTimeout(() => cb(current), 0); return () => {}; };
window.__login = (uid, name) => { current = uid ? { uid, displayName: name, email: uid + "@test" } : null; authCbs.forEach((cb) => cb(current)); };
export class GoogleAuthProvider {}
export const signInWithPopup = async () => window.__login("g1", "Google User");
export const signInWithEmailAndPassword = async (_a, e) => window.__login(e, e);
export const createUserWithEmailAndPassword = async (_a, e) => { window.__login(e, e); return { user: current }; };
export const sendPasswordResetEmail = async () => {};
export const signOut = async () => window.__login(null);
export const updateProfile = async (u, p) => Object.assign(u, p);
let idc = 0;
const join = (segs) => segs.flatMap((s) => (s.path ? s.path : s).split("/")).filter(Boolean).join("/");
export function collection(_db, ...segs) { return { type: "col", path: join(segs), filters: [] }; }
export function doc(base, ...segs) {
  if (base && base.type === "col" && segs.length === 0) return { type: "doc", path: base.path + "/id" + (++idc) + Math.random().toString(36).slice(2, 8), get id() { return this.path.split("/").pop(); } };
  const path = join(segs);
  return { type: "doc", path, id: path.split("/").pop() };
}
export const where = (f, op, v) => ({ f, op, v });
export const query = (col, ...w) => ({ ...col, filters: w });
export const serverTimestamp = () => ({ seconds: Date.now() / 1000 });
const docSnap = (path) => ({ id: path.split("/").pop(), exists: () => store.has(path), data: () => (store.has(path) ? clone(store.get(path)) : undefined) });
const colDocs = (q) => [...store.keys()].filter((k) => k.startsWith(q.path + "/") && k.split("/").length === q.path.split("/").length + 1)
  .filter((k) => q.filters.every(({ f, op, v }) => op === "==" && store.get(k)[f] === v))
  .map((k) => ({ id: k.split("/").pop(), data: () => clone(store.get(k)) }));
export const getDoc = async (r) => docSnap(r.path);
export const setDoc = async (r, d) => { store.set(r.path, clone(d)); notify(); };
export const updateDoc = async (r, d) => { if (!store.has(r.path)) throw new Error("no doc " + r.path); store.set(r.path, { ...store.get(r.path), ...clone(d) }); notify(); };
export const deleteDoc = async (r) => { store.delete(r.path); notify(); };
export function onSnapshot(r, cb) {
  const l = { fire: () => cb(r.type === "doc" ? docSnap(r.path) : { docs: colDocs(r) }) };
  listeners.add(l); setTimeout(l.fire, 0);
  return () => listeners.delete(l);
}
export function writeBatch() {
  const ops = [];
  return {
    set: (r, d) => ops.push(() => store.set(r.path, clone(d))),
    update: (r, d) => ops.push(() => store.set(r.path, { ...store.get(r.path), ...clone(d) })),
    delete: (r) => ops.push(() => store.delete(r.path)),
    commit: async () => { ops.forEach((o) => o()); notify(); },
  };
}
window.__store = store;
