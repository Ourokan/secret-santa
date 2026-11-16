import {
  initializeApp, getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInAnonymously,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail,
  signOut, getFirestore, doc, collection, getDoc, setDoc, updateDoc,
  deleteDoc, onSnapshot, query, where, writeBatch, serverTimestamp,
} from "./vendor/firebase.js";
import { firebaseConfig } from "./firebase-config.js";
import { drawMatches, diagnose } from "./match.js";
import { mascot, startSnow, addLights, confetti, drawCeremony } from "./festive.js";

startSnow();
addLights(document.getElementById("topbar"));

const fb = initializeApp(firebaseConfig);
const auth = getAuth(fb);
const db = getFirestore(fb);

// ---------- state ----------
const S = {
  user: undefined,            // undefined = loading, null = signed out
  eventId: null,
  forceShare: false,          // organizer previewing the share page
  event: undefined,           // undefined = loading, null = not found
  claims: new Map(),          // pid -> claim
  claimsLoaded: false,
  matches: new Map(),         // pid -> match (organizer only)
  blacklist: [],
  myEvents: [], myEventsLoaded: false,
  busy: false,
  authMode: "signin",
  confirm: null,
  renaming: null,
  pick: null,                 // pid the visitor tapped
  reveal: null,               // { pid, recipients } shown once
  unwrapped: false,
  shown: new Set(),           // organizer: pids whose match is shown
};
let unsubs = [];
const app = document.getElementById("app");

// ---------- tiny DOM helper ----------
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "class") el.className = v;
    else if (["value", "checked", "disabled", "selected"].includes(k)) el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

function toast(msg, bad = false) {
  const t = h("div", { class: "toast" + (bad ? " bad" : "") }, msg);
  const box = document.getElementById("toasts");
  while (box.children.length > 2) box.firstChild.remove();
  box.append(t);
  setTimeout(() => t.remove(), bad ? 6000 : 3200);
}

function friendlyError(e) {
  const code = e?.code || "";
  const map = {
    "auth/invalid-credential": "That email and password don't match.",
    "auth/wrong-password": "That email and password don't match.",
    "auth/user-not-found": "No account with that email. Create one instead?",
    "auth/email-already-in-use": "There's already an account with that email. Sign in instead.",
    "auth/weak-password": "Use at least 6 characters for your password.",
    "auth/invalid-email": "That email address doesn't look right.",
    "auth/popup-closed-by-user": "Sign-in window was closed.",
    "auth/popup-blocked": "Your browser blocked the sign-in window. Allow pop-ups and try again.",
    "auth/too-many-requests": "Too many attempts. Wait a minute and try again.",
    "auth/admin-restricted-operation": "Guest access isn't switched on yet. Ask the organizer.",
    "auth/operation-not-allowed": "Guest access isn't switched on yet. Ask the organizer.",
    "permission-denied": "That isn't allowed.",
  };
  return map[code] || e?.message || "Something went wrong.";
}

async function act(fn, okMsg) {
  if (S.busy) return;
  S.busy = true; render();
  try { await fn(); if (okMsg) toast(okMsg); }
  catch (e) { console.error(e); toast(friendlyError(e), true); }
  finally { S.busy = false; render(); }
}

// Keep what someone is typing when live data re-renders the page.
function preserveInputs(renderFn) {
  const saved = {};
  const active = document.activeElement;
  let focusId = null, selStart = null, selEnd = null;
  app.querySelectorAll("[data-keep]").forEach((el) => {
    if (el.dataset.dirty) saved[el.dataset.keep] = el.type === "checkbox" ? el.checked : el.value;
  });
  if (active && active.dataset && active.dataset.keep) {
    focusId = active.dataset.keep;
    try { selStart = active.selectionStart; selEnd = active.selectionEnd; } catch {}
  }
  renderFn();
  app.querySelectorAll("[data-keep]").forEach((el) => {
    const k = el.dataset.keep;
    if (k in saved) {
      if (el.type === "checkbox") el.checked = saved[k]; else el.value = saved[k];
      el.dataset.dirty = "1";
    }
    el.addEventListener("input", () => (el.dataset.dirty = "1"));
    el.addEventListener("change", () => (el.dataset.dirty = "1"));
    if (k === focusId) {
      el.focus();
      try { if (selStart != null) el.setSelectionRange(selStart, selEnd); } catch {}
    }
  });
}

// ---------- local memory of what this device opened ----------
const LS_KEY = "ss-opened";
function openedHere(eid) {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}")[eid] || null; } catch { return null; }
}
function rememberOpened(eid, pid, round) {
  try {
    const all = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
    all[eid] = { pid, round };
    localStorage.setItem(LS_KEY, JSON.stringify(all));
  } catch {}
}

// ---------- routing ----------
const baseUrl = () => location.origin + location.pathname;
const shareUrl = (eid) => `${baseUrl()}?e=${eid}`;
function go(eventId, opts = {}) {
  const p = new URLSearchParams();
  if (eventId) p.set("e", eventId);
  if (opts.share) p.set("view", "share");
  const qs = p.toString();
  history.pushState({}, "", qs ? `${baseUrl()}?${qs}` : baseUrl());
  onRoute();
}
window.addEventListener("popstate", onRoute);
document.getElementById("brand").addEventListener("click", (e) => { e.preventDefault(); go(null); });

let adminSubbed = false;
function clearSubs() { unsubs.forEach((u) => u()); unsubs = []; adminSubbed = false; }

function onRoute() {
  clearSubs();
  const p = new URLSearchParams(location.search);
  S.eventId = p.get("e");
  S.forceShare = p.get("view") === "share";
  S.event = undefined; S.claims = new Map(); S.claimsLoaded = false; S.matches = new Map();
  S.blacklist = []; S.confirm = null; S.renaming = null; S.pick = null; S.reveal = null; S.unwrapped = false;
  S.shown = new Set(); S.myEvents = []; S.myEventsLoaded = false;
  subscribe();
  render();
}

const isGuest = () => !!S.user?.isAnonymous;
const isOrganizerUser = () => !!S.user && !isGuest();
const isAdmin = () => isOrganizerUser() && S.event && S.event.adminUid === S.user.uid;

// ---------- data subscriptions ----------
function subscribe() {
  if (!S.eventId) {
    if (!isOrganizerUser()) return;
    unsubs.push(onSnapshot(query(collection(db, "events"), where("adminUid", "==", S.user.uid)), (snap) => {
      S.myEvents = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      S.myEventsLoaded = true; render();
    }, (e) => { console.error(e); S.myEventsLoaded = true; render(); }));
    return;
  }
  const eid = S.eventId;
  unsubs.push(onSnapshot(doc(db, "events", eid), (snap) => {
    S.event = snap.exists() ? { id: snap.id, ...snap.data() } : null;
    if (isAdmin()) subscribeAdmin();
    render();
  }, (e) => { console.error(e); S.event = null; render(); }));
  unsubs.push(onSnapshot(collection(db, "events", eid, "claims"), (snap) => {
    S.claims = new Map(snap.docs.map((d) => [d.id, d.data()]));
    S.claimsLoaded = true; render();
  }, (e) => { console.error(e); S.claimsLoaded = true; render(); }));
}

function subscribeAdmin() {
  if (adminSubbed) return;
  adminSubbed = true;
  const eid = S.eventId;
  unsubs.push(onSnapshot(doc(db, "events", eid, "admin", "blacklist"), (snap) => {
    S.blacklist = snap.exists() ? snap.data().pairs || [] : [];
    render();
  }, (e) => console.error(e)));
  unsubs.push(onSnapshot(collection(db, "events", eid, "matches"), (snap) => {
    S.matches = new Map(snap.docs.map((d) => [d.id, d.data()]));
    render();
  }, (e) => console.error(e)));
}

// ---------- helpers ----------
const people = () => S.event?.people || [];
const nameOf = (pid) => people().find((p) => p.id === pid)?.name || "Someone removed";
const namesMap = () => Object.fromEntries(people().map((p) => [p.id, p.name]));
const k = () => Math.max(1, Number(S.event?.matchesPerPerson) || 1);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const isOpened = (pid) => { const c = S.claims.get(pid); return !!c && c.round === S.event?.drawRound; };
const newId = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
const joinNames = (arr) => arr.length <= 1 ? arr.join("") : arr.slice(0, -1).join(", ") + " and " + arr[arr.length - 1];

function parseNames(text) {
  const seen = new Set();
  return text.split(/[\n,]+/).map((s) => s.trim()).filter((s) => {
    const key = s.toLowerCase();
    if (!s || seen.has(key)) return false;
    seen.add(key); return true;
  }).map((s) => s.slice(0, 60));
}

function fmtDate(s) {
  if (!s) return "";
  const d = new Date(s + "T12:00:00");
  if (isNaN(d)) return s;
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function confirmBtn(key, label, confirmLabel, onConfirm, cls = "danger small") {
  const armed = S.confirm === key;
  return h("button", {
    class: cls, disabled: S.busy,
    onclick: () => {
      if (!armed) { S.confirm = key; render(); setTimeout(() => { if (S.confirm === key) { S.confirm = null; render(); } }, 4000); return; }
      S.confirm = null; onConfirm();
    },
  }, armed ? confirmLabel : label);
}

async function copy(text, msg = "Copied!") {
  try { await navigator.clipboard.writeText(text); toast(msg); }
  catch { toast("Couldn't copy. Select the text and copy it manually.", true); }
}

function matchMessage(pid) {
  const m = S.matches.get(pid);
  const e = S.event;
  const who = joinNames((m?.recipients || []).map(nameOf));
  let msg = `🎅 Hi ${nameOf(pid)}! Your Secret Santa match for "${e.name}" is: ${who}.`;
  if (e.budget) msg += ` Budget: ${e.budget}.`;
  if (e.exchangeDate) msg += ` Exchange: ${fmtDate(e.exchangeDate)}.`;
  return msg + " Keep it secret! 🤫";
}

// ---------- organizer actions ----------
async function createEvent(form) {
  const f = new FormData(form);
  const name = (f.get("name") || "").toString().trim();
  const names = parseNames((f.get("names") || "").toString());
  if (!name) return toast("Give your exchange a name.", true);
  if (names.length < 2) return toast("Add at least 2 people, one name per line.", true);
  const ref = doc(collection(db, "events"));
  await act(async () => {
    await setDoc(ref, {
      name,
      budget: (f.get("budget") || "").toString().trim(),
      exchangeDate: (f.get("date") || "").toString(),
      matchesPerPerson: Math.max(1, Math.min(20, Number(f.get("k")) || 1)),
      avoidMutual: true,
      status: "open",
      adminUid: S.user.uid,
      people: names.map((n) => ({ id: newId(), name: n })),
      drawRound: 0,
      createdAt: serverTimestamp(),
    });
    go(ref.id);
  }, "Exchange created! Add any never-pairs, then draw names.");
}

const eventRef = () => doc(db, "events", S.eventId);

async function addPeople(text) {
  const existing = new Set(people().map((p) => p.name.toLowerCase()));
  const add = parseNames(text).filter((n) => !existing.has(n.toLowerCase()));
  if (!add.length) return toast("Those names are already on the list.", true);
  await act(() => updateDoc(eventRef(), { people: [...people(), ...add.map((n) => ({ id: newId(), name: n }))] }),
    `Added ${plural(add.length, "person", "people")}.`);
}

async function removePerson(pid) {
  await act(async () => {
    await updateDoc(eventRef(), { people: people().filter((p) => p.id !== pid) });
    const bl = S.blacklist.filter((p) => p.a !== pid && p.b !== pid);
    if (bl.length !== S.blacklist.length) await setDoc(doc(db, "events", S.eventId, "admin", "blacklist"), { pairs: bl });
  });
}

async function renamePerson(pid, name) {
  name = name.trim().slice(0, 60);
  if (!name) return;
  await act(() => updateDoc(eventRef(), { people: people().map((p) => (p.id === pid ? { ...p, name } : p)) }), "Renamed.");
}

async function saveSettings(form) {
  const f = new FormData(form);
  const name = (f.get("name") || "").toString().trim();
  if (!name) return toast("The exchange needs a name.", true);
  await act(() => updateDoc(eventRef(), {
    name,
    budget: (f.get("budget") || "").toString().trim(),
    exchangeDate: (f.get("date") || "").toString(),
    matchesPerPerson: Math.max(1, Math.min(20, Number(f.get("k")) || 1)),
    avoidMutual: form.querySelector("[name=avoidMutual]").checked,
  }), "Settings saved.");
}

async function saveBlacklist(pairs) {
  await act(() => setDoc(doc(db, "events", S.eventId, "admin", "blacklist"), { pairs }));
}

async function runDraw() {
  const ids = people().map((p) => p.id);
  const res = drawMatches(ids, k(), S.blacklist, { avoidMutual: S.event.avoidMutual !== false, names: namesMap() });
  if (!res.ok) return toast(res.error, true);
  await act(() => drawCeremony(async () => {
    const round = (S.event.drawRound || 0) + 1;
    const batch = writeBatch(db);
    for (const old of S.matches.keys()) if (!res.assignments[old]) batch.delete(doc(db, "events", S.eventId, "matches", old));
    for (const old of S.claims.keys()) batch.delete(doc(db, "events", S.eventId, "claims", old));
    for (const [giver, recipients] of Object.entries(res.assignments)) {
      batch.set(doc(db, "events", S.eventId, "matches", giver), { recipients, round });
    }
    batch.update(eventRef(), { status: "drawn", drawRound: round, drawnAt: serverTimestamp() });
    await batch.commit();
    S.shown = new Set();
  }), "Names drawn! Send everyone the share link. 🎄");
}

async function resetDraw() {
  await act(async () => {
    const batch = writeBatch(db);
    for (const pid of S.matches.keys()) batch.delete(doc(db, "events", S.eventId, "matches", pid));
    for (const pid of S.claims.keys()) batch.delete(doc(db, "events", S.eventId, "claims", pid));
    batch.update(eventRef(), { status: "open" });
    await batch.commit();
    S.shown = new Set();
  }, "Draw reset. You can edit people and settings again.");
}

async function allowReopen(pid) {
  await act(() => deleteDoc(doc(db, "events", S.eventId, "claims", pid)), `${nameOf(pid)} can open their match again.`);
}

// ---------- participant actions ----------
async function ensureGuest() {
  if (S.user) return S.user;
  const cred = await signInAnonymously(auth);
  return cred.user;
}

async function openMatch(pid) {
  await act(async () => {
    const user = await ensureGuest();
    const round = S.event.drawRound;
    try {
      await setDoc(doc(db, "events", S.eventId, "claims", pid), { uid: user.uid, round, at: serverTimestamp() });
    } catch (e) {
      if (e?.code === "permission-denied") {
        S.pick = null;
        throw { message: `${nameOf(pid)}'s match has already been opened. If that was you, ask the organizer to resend it.` };
      }
      throw e;
    }
    const snap = await getDoc(doc(db, "events", S.eventId, "matches", pid));
    if (!snap.exists()) throw { message: "Couldn't find your match. Ask the organizer." };
    rememberOpened(S.eventId, pid, round);
    S.reveal = { pid, recipients: snap.data().recipients || [] };
    S.unwrapped = false;
  });
}

// ---------- views ----------
function renderAccount() {
  const el = document.getElementById("account");
  el.replaceChildren();
  if (!isOrganizerUser()) return;
  el.append(
    h("span", { class: "who" }, S.user.displayName || S.user.email),
    h("button", { class: "ghost small", onclick: () => signOut(auth).then(() => go(null)) }, "Sign out"),
  );
}

function viewOrganizerSignIn() {
  const mode = S.authMode;
  const submit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const email = f.get("email").toString().trim();
    const pw = f.get("password").toString();
    await act(() => mode === "signup" ? createUserWithEmailAndPassword(auth, email, pw) : signInWithEmailAndPassword(auth, email, pw));
  };
  return h("div", {},
    h("div", { class: "hero" },
      mascot({ size: 170 }),
      h("h1", {}, "Secret Santa, sorted!"),
      h("p", {}, "Type in your group's names, set who shouldn't be paired, choose how many gifts each person gives, and share one link. Everyone taps their name to see their match, once."),
      h("p", { class: "small" }, "Only the organizer signs in. Everyone else just uses the link.")),
    h("div", { class: "card auth" },
      h("h2", { style: "text-align:center" }, "Organizer sign-in"),
      h("button", { class: "google", disabled: S.busy, onclick: () => act(() => signInWithPopup(auth, new GoogleAuthProvider())) },
        h("span", { class: "gicon", "aria-hidden": "true", style: "display:inline-flex" }),
        "Continue with Google"),
      h("div", { class: "divider" }, "or use email"),
      h("form", { onsubmit: submit },
        h("label", { for: "em" }, "Email"),
        h("input", { id: "em", name: "email", type: "email", autocomplete: "email", required: true }),
        h("label", { for: "pw" }, "Password"),
        h("input", { id: "pw", name: "password", type: "password", minlength: 6, required: true, autocomplete: mode === "signup" ? "new-password" : "current-password" }),
        h("div", { class: "actions" },
          h("button", { type: "submit", disabled: S.busy, style: "flex:1;justify-content:center" }, mode === "signup" ? "Create account" : "Sign in"))),
      h("p", { class: "small muted", style: "margin-top:14px;text-align:center" },
        mode === "signup" ? "Already have an account? " : "New here? ",
        h("button", { class: "link", onclick: () => { S.authMode = mode === "signup" ? "signin" : "signup"; render(); } },
          mode === "signup" ? "Sign in" : "Create an account"),
        mode === "signin" && [" · ", h("button", {
          class: "link", onclick: async () => {
            const em = app.querySelector("#em").value.trim();
            if (!em) return toast("Type your email first, then click reset.", true);
            await act(() => sendPasswordResetEmail(auth, em), "Password reset email sent.");
          },
        }, "Forgot password?")])));
}

function googleIcon(root) {
  const span = root.querySelector(".google .gicon");
  if (span) span.innerHTML = '<svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';
}

function viewHome() {
  const list = !S.myEventsLoaded
    ? h("div", { class: "loading", style: "min-height:120px" }, h("div", { class: "spinner" }))
    : S.myEvents.length === 0
      ? h("div", { class: "card empty green" }, mascot({ size: 110, mood: "sleepy" }), h("p", {}, "No exchanges yet. Start one!"))
      : S.myEvents.map((e) => h("a", {
          class: "event-link", href: `?e=${e.id}`,
          onclick: (ev) => { ev.preventDefault(); go(e.id); },
        }, h("div", { class: "card tight" },
          h("div", {},
            h("h3", { style: "margin:0" }, e.name),
            h("div", { class: "chips" },
              h("span", { class: "chip " + e.status }, e.status === "drawn" ? "Names drawn" : "Not drawn yet"),
              h("span", { class: "chip" }, plural((e.people || []).length, "person", "people")),
              e.exchangeDate && h("span", { class: "chip" }, fmtDate(e.exchangeDate)))),
          h("span", { class: "muted" }, "→"))));

  const first = (S.user.displayName || "").split(" ")[0];
  return h("div", {},
    h("div", { class: "home-head" },
      mascot({ size: 96 }),
      h("div", {},
        h("h1", { style: "margin:0" }, `Hi${first ? ", " + first : ""}!`),
        h("p", { class: "muted", style: "margin:0" }, "Your gift exchanges, all in one place."))),
    h("div", { class: "grid two", style: "margin-top:20px" },
      h("div", {}, h("h2", {}, "Your exchanges"), list),
      h("div", { class: "card green" },
        h("h2", {}, "🎄 Start a new exchange"),
        h("form", { onsubmit: (e) => { e.preventDefault(); createEvent(e.target); } },
          h("label", { for: "n" }, "Name"),
          h("input", { id: "n", name: "name", type: "text", placeholder: "Family Christmas 2026", maxlength: 100, required: true, "data-keep": "c-name" }),
          h("label", { for: "names" }, "Who's taking part?"),
          h("textarea", { id: "names", name: "names", placeholder: "One name per line\nAlice\nBob\nCarol", "data-keep": "c-names", style: "min-height:140px" }),
          h("div", { class: "help" }, "Include yourself if you're taking part."),
          h("div", { class: "row" },
            h("div", {}, h("label", { for: "b" }, "Budget"), h("input", { id: "b", name: "budget", type: "text", placeholder: "$30", maxlength: 40, "data-keep": "c-budget" })),
            h("div", {}, h("label", { for: "d" }, "Exchange date"), h("input", { id: "d", name: "date", type: "date", "data-keep": "c-date" }))),
          h("label", { for: "k" }, "Gifts per person"),
          h("input", { id: "k", name: "k", type: "number", min: 1, max: 20, value: "1", "data-keep": "c-k" }),
          h("div", { class: "help" }, "Everyone gives this many gifts and receives this many."),
          h("div", { class: "actions" }, h("button", { type: "submit", disabled: S.busy }, "Create exchange"))))));
}

function eventHeader(back) {
  const e = S.event;
  return h("div", { style: "margin-bottom:22px" },
    back && h("button", { class: "link small", onclick: () => go(null) }, "← All exchanges"),
    h("h1", { style: back ? "margin-top:8px" : "" }, e.name),
    h("div", { class: "chips" },
      e.budget && h("span", { class: "chip" }, "💰 Budget: " + e.budget),
      e.exchangeDate && h("span", { class: "chip" }, "🗓 " + fmtDate(e.exchangeDate)),
      h("span", { class: "chip" }, `🎁 ${plural(k(), "gift", "gifts")} each`)));
}

// ----- participant (share link) -----
function viewShare() {
  const e = S.event;
  const head = eventHeader(false);

  if (e.status !== "drawn") {
    return h("div", { class: "share" }, head,
      h("div", { class: "card empty" },
        mascot({ size: 130, mood: "sleepy" }),
        h("h2", {}, "Names haven't been drawn yet"),
        h("p", { class: "muted" }, "The organizer is still getting things ready. Check this link again soon!")));
  }

  // The reveal (shown once)
  if (S.reveal) {
    const names = S.reveal.recipients.map(nameOf);
    if (!S.unwrapped) {
      return h("div", { class: "share" }, head,
        h("div", { class: "card", style: "text-align:center" },
          h("h2", {}, `${nameOf(S.reveal.pid)}, your gift is ready!`),
          h("div", { class: "notice warn", style: "text-align:left" }, "📸 ", h("b", {}, "Get ready to screenshot!"), " Once you leave this page, you can't open it again."),
          h("div", { class: "gift-grid", style: "max-width:320px;margin:16px auto 0" },
            h("button", { class: "gift wrapped", "aria-label": "Unwrap your match", onclick: (ev) => {
              const el = ev.currentTarget;
              if (el.classList.contains("opening")) return;
              el.classList.add("opening");
              setTimeout(() => {
                const r = el.getBoundingClientRect();
                S.unwrapped = true; render();
                confetti(r.left + r.width / 2, r.top + r.height / 2, 90);
              }, 550);
            } }, h("span", { class: "bow" }, "🎀"), h("span", { class: "tap" }, "Tap to unwrap")))));
    }
    return h("div", { class: "share" }, head,
      h("div", { class: "screenshot-banner" }, "📸 Screenshot this now! It won't open again."),
      h("div", { class: "card reveal-card" },
        h("div", { class: "reveal-for" }, `${nameOf(S.reveal.pid)}, you're giving to:`),
        h("div", { class: "reveal-names" }, names.map((n) => h("div", { class: "reveal-name" }, "🎁 ", n))),
        h("div", { class: "chips", style: "justify-content:center;margin-top:14px" },
          e.budget && h("span", { class: "chip" }, "💰 " + e.budget),
          e.exchangeDate && h("span", { class: "chip" }, "🗓 " + fmtDate(e.exchangeDate))),
        h("p", { class: "muted small", style: "margin-top:14px" }, `Secret Santa · ${e.name}`),
        mascot({ size: 110 })));
  }

  // Confirm step
  if (S.pick) {
    return h("div", { class: "share" }, head,
      h("div", { class: "card", style: "text-align:center" },
        mascot({ size: 120, mood: "wow" }),
        h("h2", {}, `Are you ${nameOf(S.pick)}?`),
        h("div", { class: "notice warn", style: "text-align:left" },
          h("b", {}, "You can only open this once."),
          " Your match will show one time. Take a screenshot before you leave the page!"),
        h("div", { class: "actions", style: "justify-content:center" },
          h("button", { class: "ghost", disabled: S.busy, onclick: () => { S.pick = null; render(); } }, "Not me"),
          h("button", { class: "berry", disabled: S.busy, onclick: () => openMatch(S.pick) }, "🎁 Yes, open my match"))));
  }

  // Name picker
  const mine = openedHere(e.id);
  const mineNow = mine && mine.round === e.drawRound ? mine.pid : null;
  const list = [...people()].sort((a, b) => a.name.localeCompare(b.name));
  return h("div", { class: "share" }, head,
    mineNow && h("div", { class: "notice good" },
      `You already opened ${nameOf(mineNow)}'s match on this device. Lost your screenshot? Ask the organizer to resend it.`),
    h("div", { class: "card" },
      h("div", { class: "waiting" },
        mascot({ size: 96 }),
        h("div", {},
          h("h2", { style: "margin:0" }, "Tap your name"),
          h("p", { class: "muted small", style: "margin:0" }, "You'll see who you're getting a gift for. It only opens once, so be ready to screenshot!"))),
      !S.claimsLoaded ? h("div", { class: "loading", style: "min-height:100px" }, h("div", { class: "spinner" }))
        : h("div", { class: "name-grid" }, list.map((p) => {
            const done = isOpened(p.id);
            return h("button", {
              class: "name-btn" + (done ? " done" : ""), disabled: done || S.busy,
              onclick: () => { S.pick = p.id; render(); window.scrollTo({ top: 0, behavior: "smooth" }); },
            }, h("span", {}, p.name), done && h("small", {}, "opened ✓"));
          }))));
}

// ----- organizer -----
function adminPanel() {
  const e = S.event;
  const drawn = e.status === "drawn";
  const list = [...people()].sort((a, b) => a.name.localeCompare(b.name));
  const ids = list.map((p) => p.id);
  const problems = diagnose(ids, k(), S.blacklist, namesMap());
  const opened = list.filter((p) => isOpened(p.id)).length;
  const link = shareUrl(e.id);

  const shareCard = h("div", { class: "card" },
    h("h2", {}, "🔗 Share link"),
    h("p", { class: "muted small" }, drawn
      ? "Send this to everyone. They tap their name and see their match once. No account needed."
      : "You can send this now. People will see “not drawn yet” until you draw names."),
    h("div", { class: "copybox" },
      h("input", { type: "text", readonly: true, value: link, onfocus: (ev) => ev.target.select() }),
      h("button", { onclick: () => copy(link, "Share link copied!") }, "Copy")),
    h("div", { class: "actions" },
      h("button", { class: "ghost small", onclick: () => go(e.id, { share: true }) }, "👀 See what they see")));

  const drawCard = h("div", { class: "card", style: "border-color:#e5c9cf" },
    h("h2", {}, drawn ? "Names are drawn ✨" : "Draw names"),
    drawn
      ? [h("div", { class: "stats" }, h("div", {}, h("div", { class: "stat" }, `${opened}/${list.length}`), h("div", { class: "muted" }, "have opened their match"))),
         h("div", { class: "actions" },
           confirmBtn("redraw", "Redraw everyone", "Click again: everyone gets new matches", runDraw, "ghost"),
           confirmBtn("reset", "Reset draw", "Click again to reset", resetDraw, "danger"))]
      : [problems.length
          ? h("div", { class: "notice warn" }, "Not ready to draw yet:", h("ul", {}, problems.map((p) => h("li", {}, p))))
          : h("div", { class: "notice good" }, `Ready: ${plural(list.length, "person", "people")}, ${plural(k(), "gift", "gifts")} each.`),
         h("div", { class: "actions" }, h("button", { class: "berry", disabled: S.busy || problems.length > 0, onclick: runDraw }, "🎁 Draw names"))]);

  const peopleCard = h("div", { class: "card" },
    h("div", { class: "section-title" }, h("h2", {}, "People"), h("span", { class: "muted small" }, plural(list.length, "person", "people"))),
    drawn && h("p", { class: "muted small" }, "Matches are saved here in case anyone loses theirs. Showing one spoils it for you, so only peek if you need to resend."),
    h("ul", { class: "list" }, list.map((p) => {
      const m = S.matches.get(p.id);
      const shown = S.shown.has(p.id);
      return h("li", { class: "person-row" },
        h("div", { class: "person-main" },
          h("span", { class: "name" }, p.name),
          drawn && (isOpened(p.id) ? h("span", { class: "badge ok" }, "opened ✓") : h("span", { class: "badge" }, "not opened")),
          drawn && shown && m && h("div", { class: "peek" }, "→ ", joinNames(m.recipients.map(nameOf)))),
        h("div", { class: "person-actions" },
          !drawn && h("button", { class: "ghost small", disabled: S.busy, onclick: () => { S.renaming = p.id; render(); } }, "Rename"),
          !drawn && confirmBtn("rm-" + p.id, "Remove", "Confirm", () => removePerson(p.id)),
          drawn && h("button", { class: "ghost small", onclick: () => { shown ? S.shown.delete(p.id) : S.shown.add(p.id); render(); } }, shown ? "Hide" : "Show match"),
          drawn && m && h("button", { class: "ghost small", onclick: () => copy(matchMessage(p.id), `Message for ${p.name} copied. Paste it into a text!`) }, "Copy message"),
          drawn && isOpened(p.id) && confirmBtn("reopen-" + p.id, "Let them reopen", "Confirm", () => allowReopen(p.id), "ghost small")),
        S.renaming === p.id && !drawn && h("form", { class: "rename", onsubmit: (ev) => {
          ev.preventDefault(); const v = new FormData(ev.target).get("nm").toString(); S.renaming = null; renamePerson(p.id, v);
        } }, h("input", { name: "nm", type: "text", value: p.name, maxlength: 60, "data-keep": "rn-" + p.id }),
          h("button", { type: "submit", class: "small" }, "Save"),
          h("button", { type: "button", class: "ghost small", onclick: () => { S.renaming = null; render(); } }, "Cancel")));
    })),
    !drawn && h("form", { style: "margin-top:12px", onsubmit: (ev) => { ev.preventDefault(); const t = new FormData(ev.target).get("add").toString(); addPeople(t).then(() => ev.target.reset()); } },
      h("label", { for: "add" }, "Add people"),
      h("div", { class: "copybox" },
        h("input", { id: "add", name: "add", type: "text", placeholder: "Name (or several, comma-separated)", "data-keep": "add" }),
        h("button", { type: "submit", class: "ghost", disabled: S.busy }, "Add"))),
    drawn && h("p", { class: "help" }, "To add or remove people, reset the draw first."));

  const opts = list.map((p) => h("option", { value: p.id }, p.name));
  const blCard = h("div", { class: "card" },
    h("h2", {}, "🚫 Never pair"),
    h("p", { class: "muted small" }, "Keep couples, housemates, or anyone else from drawing each other."),
    S.blacklist.length === 0 ? h("p", { class: "muted small" }, "No restrictions yet.")
      : h("ul", { class: "list" }, S.blacklist.map((pr, i) => h("li", {},
          h("span", {}, nameOf(pr.a), pr.oneWay ? " won't give to " : " ⟷ ", nameOf(pr.b)),
          !drawn && h("button", { class: "danger small", disabled: S.busy, onclick: () => saveBlacklist(S.blacklist.filter((_, j) => j !== i)) }, "Remove")))),
    !drawn && list.length >= 2 && h("form", { style: "margin-top:12px", onsubmit: (ev) => {
      ev.preventDefault();
      const f = new FormData(ev.target);
      const a = f.get("a"), b = f.get("b");
      const oneWay = ev.target.querySelector("[name=oneWay]").checked;
      if (!a || !b || a === b) return toast("Pick two different people.", true);
      if (S.blacklist.some((p) => (p.a === a && p.b === b) || (!p.oneWay && p.a === b && p.b === a)))
        return toast("That pair is already on the list.", true);
      saveBlacklist([...S.blacklist, { a, b, oneWay }]);
    } },
      h("div", { class: "row" },
        h("div", {}, h("label", {}, "Person"), h("select", { name: "a", "data-keep": "bl-a" }, opts)),
        h("div", {}, h("label", {}, "Shouldn't get"), h("select", { name: "b", "data-keep": "bl-b" }, opts.map((o) => o.cloneNode(true))))),
      h("label", { class: "check", style: "margin-top:10px" },
        h("input", { type: "checkbox", name: "oneWay", "data-keep": "bl-oneway" }),
        h("span", { class: "small" }, "One way only (by default, neither can draw the other)")),
      h("div", { class: "actions" }, h("button", { type: "submit", class: "ghost", disabled: S.busy }, "Add restriction"))));

  const settingsCard = h("div", { class: "card" },
    h("h2", {}, "⚙️ Settings"),
    h("form", { onsubmit: (ev) => { ev.preventDefault(); saveSettings(ev.target); } },
      h("label", { for: "s-n" }, "Name"),
      h("input", { id: "s-n", name: "name", type: "text", value: e.name, maxlength: 100, disabled: drawn, "data-keep": "s-name" }),
      h("div", { class: "row" },
        h("div", {}, h("label", { for: "s-b" }, "Budget"), h("input", { id: "s-b", name: "budget", type: "text", value: e.budget || "", maxlength: 40, disabled: drawn, "data-keep": "s-budget" })),
        h("div", {}, h("label", { for: "s-d" }, "Exchange date"), h("input", { id: "s-d", name: "date", type: "date", value: e.exchangeDate || "", disabled: drawn, "data-keep": "s-date" }))),
      h("label", { for: "s-k" }, "Gifts per person"),
      h("input", { id: "s-k", name: "k", type: "number", min: 1, max: 20, value: String(k()), disabled: drawn, "data-keep": "s-k" }),
      h("div", { class: "help" }, "Everyone gives and receives exactly this many, so it's always balanced."),
      h("label", { class: "check", style: "margin-top:14px" },
        h("input", { type: "checkbox", name: "avoidMutual", checked: e.avoidMutual !== false, disabled: drawn, "data-keep": "s-mutual" }),
        h("span", { class: "small" }, "Avoid swaps (A gets B and B gets A) when possible")),
      !drawn && h("div", { class: "actions" }, h("button", { type: "submit", class: "ghost", disabled: S.busy }, "Save settings")),
      drawn && h("p", { class: "help" }, "Reset the draw to change settings.")));

  return h("div", {}, eventHeader(true),
    h("div", { class: "grid two" },
      h("div", {}, shareCard, drawCard, peopleCard),
      h("div", {}, blCard, settingsCard)));
}

function viewEvent() {
  if (S.event === undefined) return h("div", { class: "loading" }, h("div", { class: "spinner" }));
  if (S.event === null) {
    return h("div", { class: "card empty" },
      mascot({ size: 110, mood: "wow" }),
      h("h2", {}, "This link doesn't work"),
      h("p", {}, "Double-check the link, or ask the organizer to send it again."));
  }
  if (isAdmin() && !S.forceShare) return adminPanel();
  return h("div", {},
    isAdmin() && h("div", { class: "notice warn" }, "You're previewing the share page. ",
      h("button", { class: "link", onclick: () => go(S.eventId) }, "Back to organizer view")),
    viewShare());
}

function render() {
  renderAccount();
  preserveInputs(() => {
    let view;
    if (S.user === undefined) view = h("div", { class: "loading" }, h("div", { class: "spinner" }));
    else if (S.eventId) view = viewEvent();
    else if (!isOrganizerUser()) view = viewOrganizerSignIn();
    else view = viewHome();
    app.replaceChildren(view);
    googleIcon(app);
  });
}

// Nudge people who try to leave the reveal before screenshotting.
window.addEventListener("beforeunload", (e) => {
  if (S.reveal) { e.preventDefault(); e.returnValue = ""; }
});

onAuthStateChanged(auth, (user) => {
  const prev = S.user;
  S.user = user || null;
  // A guest session starting mid-reveal shouldn't reset the page.
  if (prev === undefined || (prev?.uid !== S.user?.uid && !S.reveal && !S.busy)) onRoute();
  else render();
});
render();
