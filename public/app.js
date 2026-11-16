import {
  initializeApp, getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail,
  signOut, updateProfile, getFirestore, doc, collection, getDoc, setDoc, updateDoc,
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
  user: undefined,          // undefined = loading, null = signed out
  eventId: null,
  event: undefined,         // undefined = loading, null = not found
  participants: new Map(),  // uid -> data
  participantsLoaded: false,
  assignment: undefined,
  blacklist: [],
  myEvents: [],             // [{id, name, status, admin}]
  myEventsLoaded: false,
  busy: false,
  revealed: new Set(),
  authMode: "signin",
  confirm: null,            // key of an action awaiting a second click
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
  document.getElementById("toasts").append(t);
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
    "permission-denied": "You don't have permission to do that.",
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

// ---------- routing ----------
function readRoute() {
  const p = new URLSearchParams(location.search);
  return p.get("e");
}
function baseUrl() {
  return location.origin + location.pathname;
}
function go(eventId) {
  const url = eventId ? `${baseUrl()}?e=${encodeURIComponent(eventId)}` : baseUrl();
  history.pushState({}, "", url);
  onRoute();
}
window.addEventListener("popstate", onRoute);
document.getElementById("brand").addEventListener("click", (e) => { e.preventDefault(); go(null); });

function clearSubs() { unsubs.forEach((u) => u()); unsubs = []; }

function onRoute() {
  clearSubs();
  S.eventId = readRoute();
  S.event = undefined; S.participants = new Map(); S.participantsLoaded = false;
  S.assignment = undefined; S.blacklist = []; S.revealed = new Set(); S.confirm = null;
  S.myEvents = []; S.myEventsLoaded = false;
  if (S.user) subscribe();
  render();
}

// ---------- data subscriptions ----------
function subscribe() {
  const uid = S.user.uid;
  if (!S.eventId) {
    // Home: events I organise + events I've joined.
    let admin = [], joined = [], gotA = false, gotJ = false;
    const merge = async () => {
      if (!gotA || !gotJ) return;
      const map = new Map();
      admin.forEach((e) => map.set(e.id, { ...e, admin: true }));
      for (const j of joined) {
        if (map.has(j.id)) continue;
        try {
          const s = await getDoc(doc(db, "events", j.id));
          if (s.exists()) map.set(j.id, { id: j.id, ...s.data(), admin: false });
        } catch {}
      }
      S.myEvents = [...map.values()].sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      S.myEventsLoaded = true;
      render();
    };
    unsubs.push(onSnapshot(query(collection(db, "events"), where("adminUid", "==", uid)), (snap) => {
      admin = snap.docs.map((d) => ({ id: d.id, ...d.data() })); gotA = true; merge();
    }, (e) => { console.error(e); gotA = true; merge(); }));
    unsubs.push(onSnapshot(collection(db, "users", uid, "memberships"), (snap) => {
      joined = snap.docs.map((d) => ({ id: d.id, ...d.data() })); gotJ = true; merge();
    }, (e) => { console.error(e); gotJ = true; merge(); }));
    return;
  }

  const eid = S.eventId;
  unsubs.push(onSnapshot(doc(db, "events", eid), (snap) => {
    const wasAdmin = isAdmin();
    S.event = snap.exists() ? { id: snap.id, ...snap.data() } : null;
    if (!wasAdmin && isAdmin()) subscribeAdmin();
    render();
  }, (e) => { console.error(e); S.event = null; render(); }));

  unsubs.push(onSnapshot(collection(db, "events", eid, "participants"), (snap) => {
    S.participants = new Map(snap.docs.map((d) => [d.id, d.data()]));
    S.participantsLoaded = true;
    render();
  }, (e) => { console.error(e); S.participantsLoaded = true; render(); }));

  unsubs.push(onSnapshot(doc(db, "events", eid, "assignments", uid), (snap) => {
    S.assignment = snap.exists() ? snap.data() : null;
    render();
  }, (e) => { console.error(e); S.assignment = null; render(); }));
}

let adminSubbed = false;
function subscribeAdmin() {
  if (adminSubbed) return;
  adminSubbed = true;
  const u = onSnapshot(doc(db, "events", S.eventId, "admin", "blacklist"), (snap) => {
    S.blacklist = snap.exists() ? snap.data().pairs || [] : [];
    render();
  }, (e) => console.error(e));
  unsubs.push(() => { u(); adminSubbed = false; });
}

// ---------- helpers ----------
const isAdmin = () => !!(S.user && S.event && S.event.adminUid === S.user.uid);
const me = () => S.participants.get(S.user?.uid);
const nameOf = (uid) => S.participants.get(uid)?.displayName || "Someone who left";
const names = () => Object.fromEntries([...S.participants].map(([id, p]) => [id, p.displayName]));
const k = () => Math.max(1, Number(S.event?.matchesPerPerson) || 1);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

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

// ---------- actions ----------
async function createEvent(form) {
  const f = new FormData(form);
  const name = (f.get("name") || "").toString().trim();
  if (!name) return toast("Give your exchange a name.", true);
  const participating = form.querySelector("[name=participating]").checked;
  const myName = (f.get("myName") || "").toString().trim();
  if (participating && !myName) return toast("Add your name so your Secret Santa knows who you are.", true);
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
      drawRound: 0,
      assignedUids: [],
      createdAt: serverTimestamp(),
    });
    if (participating) await joinEvent(ref.id, myName, "", name);
    go(ref.id);
  }, "Exchange created. Send people the invite link.");
}

async function joinEvent(eid, displayName, wishlist, eventName) {
  await setDoc(doc(db, "events", eid, "participants", S.user.uid), {
    displayName, wishlist, joinedAt: serverTimestamp(),
  });
  await setDoc(doc(db, "users", S.user.uid, "memberships", eid), { name: eventName || "", joinedAt: serverTimestamp() });
}

async function leaveEvent() {
  await act(async () => {
    await deleteDoc(doc(db, "events", S.eventId, "participants", S.user.uid));
    await deleteDoc(doc(db, "users", S.user.uid, "memberships", S.eventId));
  }, "You've left this exchange.");
}

async function saveMyDetails(form) {
  const f = new FormData(form);
  const displayName = (f.get("displayName") || "").toString().trim();
  if (!displayName) return toast("Your name can't be empty.", true);
  await act(() => updateDoc(doc(db, "events", S.eventId, "participants", S.user.uid), {
    displayName, wishlist: (f.get("wishlist") || "").toString().slice(0, 2000),
  }), "Saved.");
}

async function saveSettings(form) {
  const f = new FormData(form);
  const name = (f.get("name") || "").toString().trim();
  if (!name) return toast("The exchange needs a name.", true);
  await act(() => updateDoc(doc(db, "events", S.eventId), {
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

async function removeParticipant(uid) {
  await act(() => deleteDoc(doc(db, "events", S.eventId, "participants", uid)), "Removed.");
}

async function runDraw() {
  const ids = [...S.participants.keys()];
  const res = drawMatches(ids, k(), S.blacklist, { avoidMutual: S.event.avoidMutual !== false, names: names() });
  if (!res.ok) return toast(res.error, true);
  await act(() => drawCeremony(async () => {
    const round = (S.event.drawRound || 0) + 1;
    const batch = writeBatch(db);
    for (const old of S.event.assignedUids || []) {
      if (!res.assignments[old]) batch.delete(doc(db, "events", S.eventId, "assignments", old));
    }
    for (const [giver, recipients] of Object.entries(res.assignments)) {
      batch.set(doc(db, "events", S.eventId, "assignments", giver), { recipients, round });
    }
    batch.update(doc(db, "events", S.eventId), {
      status: "drawn", drawRound: round, drawnAt: serverTimestamp(), assignedUids: ids,
    });
    await batch.commit();
  }), "Names drawn! Everyone can now see who they're shopping for. 🎄");
}

async function resetDraw() {
  await act(async () => {
    const batch = writeBatch(db);
    for (const uid of S.event.assignedUids || []) batch.delete(doc(db, "events", S.eventId, "assignments", uid));
    batch.update(doc(db, "events", S.eventId), { status: "open", assignedUids: [] });
    await batch.commit();
  }, "Draw reset. Sign-ups are open again.");
}

async function markViewed() {
  const p = me();
  if (!p || p.viewedRound === S.event.drawRound) return;
  try {
    await updateDoc(doc(db, "events", S.eventId, "participants", S.user.uid), {
      viewedRound: S.event.drawRound, viewedAt: serverTimestamp(),
    });
  } catch (e) { console.error(e); }
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast("Invite link copied."); }
  catch { toast("Couldn't copy. Select the link and copy it manually.", true); }
}

// ---------- views ----------
function renderAccount() {
  const el = document.getElementById("account");
  el.replaceChildren();
  if (!S.user) return;
  el.append(
    h("span", { class: "who" }, S.user.displayName || S.user.email),
    h("button", { class: "ghost small", onclick: () => signOut(auth) }, "Sign out"),
  );
}

function viewSignIn() {
  const mode = S.authMode;
  const inviting = !!S.eventId;
  const submit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const email = f.get("email").toString().trim();
    const pw = f.get("password").toString();
    await act(async () => {
      if (mode === "signup") {
        const cred = await createUserWithEmailAndPassword(auth, email, pw);
        const nm = (f.get("name") || "").toString().trim();
        if (nm) await updateProfile(cred.user, { displayName: nm });
      } else {
        await signInWithEmailAndPassword(auth, email, pw);
      }
    });
  };
  return h("div", {},
    h("div", { class: "hero" },
      mascot({ size: 170, say: inviting ? "Woof! You're invited!" : "Ho ho ho-wl!" }),
      h("h1", {}, inviting ? "You've been invited to a Secret Santa!" : "Secret Santa, sorted!"),
      h("p", {}, inviting
        ? "Sign in to join. Once names are drawn, you'll see who you're shopping for, and no one else will."
        : "Invite your group, set who shouldn't be paired, choose how many gifts each person gives, and let the draw keep everyone's secret."),
    ),
    h("div", { class: "card auth" },
      h("button", { class: "google", disabled: S.busy, onclick: () => act(() => signInWithPopup(auth, new GoogleAuthProvider())) },
        h("span", { class: "gicon", "aria-hidden": "true", style: "display:inline-flex" }),
        "Continue with Google"),
      h("div", { class: "divider" }, "or use email"),
      h("form", { onsubmit: submit },
        mode === "signup" && [h("label", { for: "nm" }, "Your name"), h("input", { id: "nm", name: "name", type: "text", autocomplete: "name", required: true })],
        h("label", { for: "em" }, "Email"),
        h("input", { id: "em", name: "email", type: "email", autocomplete: "email", required: true }),
        h("label", { for: "pw" }, "Password"),
        h("input", { id: "pw", name: "password", type: "password", minlength: 6, required: true, autocomplete: mode === "signup" ? "new-password" : "current-password" }),
        h("div", { class: "actions" },
          h("button", { type: "submit", disabled: S.busy, style: "flex:1;justify-content:center" }, mode === "signup" ? "Create account" : "Sign in")),
      ),
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
        }, "Forgot password?")],
      ),
    ),
  );
}

function googleIcon(root) {
  const span = root.querySelector(".google .gicon");
  if (span) span.innerHTML = '<svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';
}

function viewHome() {
  const list = !S.myEventsLoaded
    ? h("div", { class: "loading", style: "min-height:120px" }, h("div", { class: "spinner" }))
    : S.myEvents.length === 0
      ? h("div", { class: "card empty green" }, mascot({ size: 110, mood: "sleepy" }), h("p", {}, "No exchanges yet. Start one, or open an invite link someone sent you."))
      : S.myEvents.map((e) => h("a", {
          class: "event-link", href: `?e=${e.id}`,
          onclick: (ev) => { ev.preventDefault(); go(e.id); },
        }, h("div", { class: "card tight" },
          h("div", {},
            h("h3", { style: "margin:0" }, e.name),
            h("div", { class: "chips" },
              h("span", { class: "chip " + e.status }, e.status === "drawn" ? "Names drawn" : "Sign-ups open"),
              e.exchangeDate && h("span", { class: "chip" }, fmtDate(e.exchangeDate)),
              e.admin && h("span", { class: "chip" }, "Organizer"))),
          h("span", { class: "muted" }, "→"))));

  const defaultName = S.user.displayName || "";
  return h("div", {},
    h("div", { class: "home-head" },
      mascot({ size: 96 }),
      h("div", {},
        h("h1", { style: "margin:0" }, `Hi${defaultName ? ", " + defaultName.split(" ")[0] : ""}!`),
        h("p", { class: "muted", style: "margin:0" }, "Your gift exchanges, all in one place."))),
    h("div", { class: "grid two", style: "margin-top:20px" },
      h("div", {}, h("h2", {}, "Your exchanges"), list),
      h("div", { class: "card green" },
        h("h2", {}, "🎄 Start a new exchange"),
        h("form", { onsubmit: (e) => { e.preventDefault(); createEvent(e.target); } },
          h("label", { for: "n" }, "Name"),
          h("input", { id: "n", name: "name", type: "text", placeholder: "Family Christmas 2026", maxlength: 100, required: true, "data-keep": "c-name" }),
          h("div", { class: "row" },
            h("div", {}, h("label", { for: "b" }, "Budget"), h("input", { id: "b", name: "budget", type: "text", placeholder: "$30", maxlength: 40, "data-keep": "c-budget" })),
            h("div", {}, h("label", { for: "d" }, "Exchange date"), h("input", { id: "d", name: "date", type: "date", "data-keep": "c-date" }))),
          h("label", { for: "k" }, "Gifts per person"),
          h("input", { id: "k", name: "k", type: "number", min: 1, max: 20, value: "1", "data-keep": "c-k" }),
          h("div", { class: "help" }, "Everyone gives this many gifts and receives this many. You can change it before the draw."),
          h("label", { class: "check", style: "margin-top:16px" },
            h("input", { type: "checkbox", name: "participating", checked: true, "data-keep": "c-part",
              onchange: (e) => { app.querySelector("#myNameWrap").style.display = e.target.checked ? "" : "none"; } }),
            h("span", {}, "I'm taking part too")),
          h("div", { id: "myNameWrap" },
            h("label", { for: "mn" }, "Your name (as others will see it)"),
            h("input", { id: "mn", name: "myName", type: "text", value: defaultName, maxlength: 60, "data-keep": "c-myname" })),
          h("div", { class: "actions" }, h("button", { type: "submit", disabled: S.busy }, "Create exchange")),
        ))));
}

function eventHeader() {
  const e = S.event;
  return h("div", { style: "margin-bottom:22px" },
    h("button", { class: "link small", onclick: () => go(null) }, "← All exchanges"),
    h("h1", { style: "margin-top:8px" }, e.name),
    h("div", { class: "chips" },
      h("span", { class: "chip " + e.status }, e.status === "drawn" ? "Names drawn" : "Sign-ups open"),
      e.budget && h("span", { class: "chip" }, "Budget: " + e.budget),
      e.exchangeDate && h("span", { class: "chip" }, "🗓 " + fmtDate(e.exchangeDate)),
      h("span", { class: "chip" }, `${plural(k(), "gift", "gifts")} per person`),
      h("span", { class: "chip" }, plural(S.participants.size, "person", "people"))));
}

function myDetailsForm(p) {
  return h("form", { onsubmit: (e) => { e.preventDefault(); saveMyDetails(e.target); } },
    h("label", { for: "dn" }, "Your name"),
    h("input", { id: "dn", name: "displayName", type: "text", value: p.displayName, maxlength: 60, "data-keep": "m-name" }),
    h("label", { for: "wl" }, "Your wishlist"),
    h("textarea", { id: "wl", name: "wishlist", maxlength: 2000, placeholder: "Sizes, hobbies, things you'd love, things you definitely don't need…", "data-keep": "m-wish" }, p.wishlist || ""),
    h("div", { class: "help" }, "Whoever draws you will see this. You can update it any time."),
    h("div", { class: "actions" }, h("button", { type: "submit", disabled: S.busy }, "Save")));
}

function participantPanel() {
  const e = S.event;
  const p = me();

  if (!p) {
    if (e.status !== "open" && isAdmin()) {
      return h("div", { class: "card" },
        h("h2", {}, "You're organizing this one"),
        h("p", { class: "muted" }, "You didn't join as a participant, so you don't have a match."));
    }
    if (e.status !== "open") {
      return h("div", { class: "card" },
        h("h2", {}, "Names have already been drawn"),
        h("p", { class: "muted" }, "Ask the organizer to reset the draw if you'd like to join."));
    }
    return h("div", { class: "card" },
      h("h2", {}, "Join this exchange"),
      h("p", { class: "muted" }, "Once the organizer draws names, you'll see who you're giving to here."),
      h("form", { onsubmit: async (ev) => {
        ev.preventDefault();
        const f = new FormData(ev.target);
        const dn = f.get("displayName").toString().trim();
        if (!dn) return toast("Add your name.", true);
        await act(async () => { await joinEvent(e.id, dn, f.get("wishlist").toString().slice(0, 2000), e.name); confetti(); }, "You're in! 🎉");
      } },
        h("label", { for: "jn" }, "Your name"),
        h("input", { id: "jn", name: "displayName", type: "text", value: S.user.displayName || "", maxlength: 60, required: true, "data-keep": "j-name" }),
        h("label", { for: "jw" }, "Wishlist (optional)"),
        h("textarea", { id: "jw", name: "wishlist", maxlength: 2000, placeholder: "Ideas for whoever draws you…", "data-keep": "j-wish" }),
        h("div", { class: "actions" }, h("button", { type: "submit", class: "berry", disabled: S.busy }, "Join"))));
  }

  if (e.status === "open") {
    return h("div", {},
      h("div", { class: "card" },
        h("div", { class: "waiting" },
          mascot({ size: 100, mood: "sleepy" }),
          h("div", {},
            h("h2", {}, "You're in! 🎄"),
            h("p", { class: "muted", style: "margin:0" }, "Waiting for the organizer to draw names. Check back here, and your match(es) will appear on this page."))),
        myDetailsForm(p),
        h("div", { style: "margin-top:18px;border-top:1px solid var(--line);padding-top:14px" },
          confirmBtn("leave", "Leave this exchange", "Click again to leave", leaveEvent))));
  }

  // drawn
  const a = S.assignment;
  let body;
  if (a === undefined) body = h("div", { class: "loading", style: "min-height:120px" }, h("div", { class: "spinner" }));
  else if (!a || a.round !== e.drawRound) body = h("p", { class: "muted" }, "Your match isn't ready yet. Hang tight.");
  else {
    body = h("div", { class: "gift-grid" }, a.recipients.map((rid) => {
      if (!S.revealed.has(rid)) {
        return h("button", { class: "gift wrapped", "aria-label": "Unwrap your match", onclick: (ev) => {
          const el = ev.currentTarget;
          if (el.classList.contains("opening")) return;
          el.classList.add("opening");
          setTimeout(() => {
            const r = el.getBoundingClientRect();
            S.revealed.add(rid); markViewed(); render();
            confetti(r.left + r.width / 2, r.top + r.height / 2, 60);
          }, 550);
        } },
          h("span", { class: "bow" }, "🎀"), h("span", { class: "tap" }, "Tap to unwrap"));
      }
      const rp = S.participants.get(rid);
      return h("div", { class: "gift revealed" },
        h("div", { class: "label" }, "You're giving to"),
        h("div", { class: "who" }, rp?.displayName || "Someone who left"),
        h("div", { class: "label", style: "margin-bottom:6px" }, "Their wishlist"),
        h("div", { class: "wish" }, rp?.wishlist?.trim() || "No wishlist yet. Check back later."));
    }));
  }
  return h("div", {},
    h("div", { class: "card" },
      h("h2", {}, a && a.recipients?.length > 1 ? "🎁 Your Secret Santa matches" : "🎁 Your Secret Santa match"),
      h("p", { class: "muted small" }, "Only you can see this. Keep it secret! 🤫"),
      body),
    h("div", { class: "card" }, h("h3", {}, "Your details"), myDetailsForm(p)));
}

function adminPanel() {
  const e = S.event;
  const drawn = e.status === "drawn";
  const invite = `${baseUrl()}?e=${e.id}`;
  const people = [...S.participants.entries()].sort((a, b) => a[1].displayName.localeCompare(b[1].displayName));
  const viewed = people.filter(([, p]) => p.viewedRound === e.drawRound).length;
  const problems = diagnose(people.map(([id]) => id), k(), S.blacklist, names());

  // Invite
  const inviteCard = h("div", { class: "card" },
    h("span", { class: "admin-tag" }, "Organizer"),
    h("h2", {}, "Invite people"),
    h("p", { class: "muted small" }, "Anyone with this link can sign in and join until you draw names."),
    h("div", { class: "copybox" },
      h("input", { type: "text", readonly: true, value: invite, onfocus: (ev) => ev.target.select() }),
      h("button", { onclick: () => copy(invite) }, "Copy")));

  // Participants
  const peopleCard = h("div", { class: "card" },
    h("div", { class: "section-title" }, h("h2", {}, "People"), h("span", { class: "muted small" }, plural(people.length, "person", "people"))),
    drawn && h("div", { class: "stats" },
      h("div", {}, h("div", { class: "stat" }, `${viewed}/${people.length}`), h("div", { class: "muted" }, "have opened their match"))),
    people.length === 0 ? h("p", { class: "empty" }, "No one has joined yet. Share the invite link.")
      : h("ul", { class: "list" }, people.map(([id, p]) => h("li", {},
          h("div", {},
            h("span", { class: "name" }, p.displayName),
            id === e.adminUid && h("span", { class: "badge admin", style: "margin-left:8px" }, "you"),
            p.wishlist?.trim() ? null : h("span", { class: "badge", style: "margin-left:8px" }, "no wishlist")),
          h("div", { style: "display:flex;gap:8px;align-items:center" },
            drawn && (p.viewedRound === e.drawRound
              ? h("span", { class: "badge ok" }, "opened ✓") : h("span", { class: "badge" }, "not opened")),
            !drawn && confirmBtn("rm-" + id, "Remove", "Confirm", () => removeParticipant(id)))))),
    drawn && h("p", { class: "help" }, "To add or remove people, reset the draw first."));

  // Blacklist
  const opts = people.map(([id, p]) => h("option", { value: id }, p.displayName));
  const blCard = h("div", { class: "card" },
    h("h2", {}, "Never pair"),
    h("p", { class: "muted small" }, "Keep couples, housemates, or anyone else from drawing each other."),
    S.blacklist.length === 0 ? h("p", { class: "muted small" }, "No restrictions yet.")
      : h("ul", { class: "list" }, S.blacklist.map((pr, i) => h("li", {},
          h("span", {}, nameOf(pr.a), pr.oneWay ? " won't give to " : " ⟷ ", nameOf(pr.b)),
          !drawn && h("button", { class: "danger small", disabled: S.busy,
            onclick: () => saveBlacklist(S.blacklist.filter((_, j) => j !== i)) }, "Remove")))),
    !drawn && people.length >= 2 && h("form", { style: "margin-top:12px", onsubmit: (ev) => {
      ev.preventDefault();
      const f = new FormData(ev.target);
      const a = f.get("a"), b = f.get("b");
      const oneWay = ev.target.querySelector("[name=oneWay]").checked;
      if (!a || !b || a === b) return toast("Pick two different people.", true);
      if (S.blacklist.some((p) => (p.a === a && p.b === b) || (!oneWay && !p.oneWay && p.a === b && p.b === a)))
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

  // Settings
  const settingsCard = h("div", { class: "card" },
    h("h2", {}, "Settings"),
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

  // Draw
  const drawCard = h("div", { class: "card", style: "border-color:#e5c9cf" },
    h("h2", {}, drawn ? "Names are drawn ✨" : "Draw names"),
    drawn
      ? [h("p", { class: "muted small" }, "Each person can see only their own match. As the organizer, you can't see anyone else's either."),
         h("div", { class: "actions" },
           confirmBtn("redraw", "Redraw", "Click again: everyone gets new matches", runDraw, "ghost"),
           confirmBtn("reset", "Reset & reopen sign-ups", "Click again to reset", resetDraw, "danger"))]
      : [
          problems.length
            ? h("div", { class: "notice warn" }, "Not ready to draw yet:", h("ul", {}, problems.map((p) => h("li", {}, p))))
            : h("div", { class: "notice good" }, `Ready: ${plural(people.length, "person", "people")}, ${plural(k(), "gift", "gifts")} each.`),
          h("p", { class: "muted small" }, "Drawing closes sign-ups. You can reset later if someone joins late."),
          h("div", { class: "actions" },
            h("button", { class: "berry", disabled: S.busy || problems.length > 0, onclick: runDraw }, "🎁 Draw names")),
        ]);

  return h("div", {}, inviteCard, drawCard, peopleCard, blCard, settingsCard);
}

function viewEvent() {
  if (S.event === undefined || !S.participantsLoaded) return h("div", { class: "loading" }, h("div", { class: "spinner" }));
  if (S.event === null) {
    return h("div", { class: "card empty" },
      mascot({ size: 110, mood: "wow" }),
      h("h2", {}, "This invite link doesn't work"),
      h("p", {}, "Double-check the link, or ask the organizer to send it again."),
      h("button", { onclick: () => go(null) }, "Go to my exchanges"));
  }
  if (isAdmin()) subscribeAdmin();
  const admin = isAdmin();
  return h("div", {},
    eventHeader(),
    admin
      ? h("div", { class: "grid two" }, h("div", {}, participantPanel()), adminPanel())
      : h("div", { style: "max-width:640px" }, participantPanel()));
}

function render() {
  renderAccount();
  preserveInputs(() => {
    let view;
    if (S.user === undefined) view = h("div", { class: "loading" }, h("div", { class: "spinner" }));
    else if (!S.user) view = viewSignIn();
    else if (!S.eventId) view = viewHome();
    else view = viewEvent();
    app.replaceChildren(view);
    googleIcon(app);
  });
}

onAuthStateChanged(auth, (user) => {
  S.user = user || null;
  onRoute();
});
render();
