// Whimsical bits: the Santa shiba mascot, snow, twinkle lights, confetti.

const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Original illustration: a shiba inu in a Santa hat and scarf.
export function shibaSVG({ size = 160, mood = "happy", label = "Santa shiba" } = {}) {
  const eyes = mood === "sleepy"
    ? `<path d="M73 113 q7 6 14 0" class="lid"/><path d="M113 113 q7 6 14 0" class="lid"/>`
    : `<g class="eyes">
         <ellipse cx="80" cy="112" rx="6.5" ry="7.5" fill="#2a1a12"/>
         <ellipse cx="120" cy="112" rx="6.5" ry="7.5" fill="#2a1a12"/>
         <circle cx="82.5" cy="109" r="2.2" fill="#fff"/>
         <circle cx="122.5" cy="109" r="2.2" fill="#fff"/>
       </g>`;
  const mouth = mood === "wow"
    ? `<ellipse cx="100" cy="148" rx="7" ry="8" fill="#7a2b2b"/><ellipse cx="100" cy="151" rx="4.5" ry="3.5" fill="#f28b8b"/>`
    : `<path d="M100 149 q0 11 -7 11 q-6 0 -5 -7 q2 -4 12 -4z" fill="#f28b8b" class="tongue"/>
       <path d="M86 141 q7 9 14 1 q7 8 14 -1" fill="none" stroke="#2a1a12" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
  return `
<svg class="shiba shiba-${mood}" width="${size}" height="${size}" viewBox="0 0 200 210" role="img" aria-label="${label}">
  <g class="shiba-body">
    <!-- scarf -->
    <path d="M50 160 Q100 190 150 160 L152 178 Q100 206 48 178 Z" fill="#c8323f"/>
    <path d="M62 168 l6 16 M84 175 l4 17 M108 176 l-2 17 M130 171 l-5 16" stroke="#2f7d55" stroke-width="6" stroke-linecap="round"/>
    <path class="scarf-tail" d="M128 176 l20 30 l-16 4 l-14 -30 Z" fill="#c8323f"/>
    <path d="M136 188 l9 -4 M142 197 l8 -3" stroke="#2f7d55" stroke-width="4" stroke-linecap="round"/>
    <g class="shiba-head">
      <!-- ears -->
      <path d="M44 98 L50 34 Q54 28 60 34 L92 66 Z" fill="#e0893a" stroke="#c4702a" stroke-width="2" stroke-linejoin="round"/>
      <path d="M56 86 L59 48 L82 68 Z" fill="#fbe3c4"/>
      <path class="ear-r" d="M156 98 L150 34 Q146 28 140 34 L108 66 Z" fill="#e0893a" stroke="#c4702a" stroke-width="2" stroke-linejoin="round"/>
      <path class="ear-r" d="M144 86 L141 48 L118 68 Z" fill="#fbe3c4"/>
      <!-- head -->
      <ellipse cx="100" cy="114" rx="62" ry="54" fill="#e8913a"/>
      <!-- cream mask -->
      <path d="M44 116 Q52 170 100 168 Q148 170 156 116 Q132 140 100 128 Q68 140 44 116 Z" fill="#fbe9d0"/>
      <ellipse cx="100" cy="142" rx="27" ry="21" fill="#fbe9d0"/>
      <!-- eyebrow dots -->
      <ellipse cx="78" cy="97" rx="6" ry="4" fill="#fbe9d0"/>
      <ellipse cx="122" cy="97" rx="6" ry="4" fill="#fbe9d0"/>
      ${eyes}
      <!-- blush -->
      <ellipse cx="64" cy="132" rx="10" ry="5.5" fill="#f4a3a0" opacity=".75"/>
      <ellipse cx="136" cy="132" rx="10" ry="5.5" fill="#f4a3a0" opacity=".75"/>
      <!-- nose + mouth -->
      <ellipse cx="100" cy="131" rx="9.5" ry="6.5" fill="#2a1a12"/>
      <ellipse cx="97" cy="129" rx="3" ry="1.6" fill="#fff" opacity=".5"/>
      ${mouth}
      <!-- santa hat -->
      <g class="hat">
        <path d="M60 78 C62 40 96 16 128 22 C154 28 170 52 176 84 L164 86 C158 64 148 52 138 52 C142 62 144 70 144 78 Z" fill="#d6303f"/>
        <path d="M76 60 C90 36 120 30 140 40" stroke="#ef5a66" stroke-width="5" fill="none" stroke-linecap="round" opacity=".6"/>
        <rect x="52" y="68" width="98" height="20" rx="10" fill="#fff" stroke="#eadfd2" stroke-width="2"/>
        <g class="pompom"><circle cx="172" cy="90" r="11" fill="#fff" stroke="#eadfd2" stroke-width="2"/></g>
      </g>
    </g>
  </g>
</svg>`;
}

export function mascot(opts = {}) {
  const wrap = document.createElement("div");
  wrap.className = "mascot " + (opts.class || "");
  wrap.innerHTML = shibaSVG(opts);
  if (opts.say) {
    const b = document.createElement("div");
    b.className = "bubble";
    b.textContent = opts.say;
    wrap.append(b);
  }
  return wrap;
}

export function startSnow() {
  if (document.querySelector(".snow")) return;
  const layer = document.createElement("div");
  layer.className = "snow";
  layer.setAttribute("aria-hidden", "true");
  const flakes = window.innerWidth < 600 ? 22 : 45;
  for (let i = 0; i < flakes; i++) {
    const f = document.createElement("span");
    f.className = "flake";
    f.textContent = Math.random() < .35 ? "❄" : "•";
    const size = 6 + Math.random() * 14;
    f.style.cssText = `left:${Math.random() * 100}vw;font-size:${size}px;opacity:${.35 + Math.random() * .55};` +
      `animation-duration:${9 + Math.random() * 14}s, ${3 + Math.random() * 4}s;animation-delay:-${Math.random() * 20}s, -${Math.random() * 4}s;`;
    layer.append(f);
  }
  document.body.prepend(layer);
}

export function addLights(host) {
  if (!host || host.querySelector(".lights")) return;
  const row = document.createElement("div");
  row.className = "lights";
  row.setAttribute("aria-hidden", "true");
  const n = Math.ceil(window.innerWidth / 46) + 2;
  const colors = ["#ff5a5f", "#ffd166", "#3ddc97", "#5ab0ff", "#ff8fd1"];
  for (let i = 0; i < n; i++) {
    const b = document.createElement("span");
    b.className = "bulb";
    b.style.setProperty("--c", colors[i % colors.length]);
    b.style.animationDelay = `${(i % 5) * .35}s`;
    row.append(b);
  }
  host.append(row);
}

export function confetti(x = window.innerWidth / 2, y = window.innerHeight / 3, count = 70) {
  if (reduceMotion()) return;
  const colors = ["#d6303f", "#2f7d55", "#ffd166", "#ffffff", "#5ab0ff", "#ff8fd1"];
  const shapes = ["", "round", "star"];
  for (let i = 0; i < count; i++) {
    const p = document.createElement("span");
    const shape = shapes[i % 3];
    p.className = "confetto " + shape;
    if (shape === "star") p.textContent = "✦";
    p.style.background = shape === "star" ? "transparent" : colors[i % colors.length];
    p.style.color = colors[i % colors.length];
    p.style.left = x + "px";
    p.style.top = y + "px";
    document.body.append(p);
    const angle = Math.random() * Math.PI * 2;
    const dist = 80 + Math.random() * 220;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist - 120;
    p.animate([
      { transform: "translate(-50%,-50%) rotate(0deg) scale(1)", opacity: 1 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${360 + Math.random() * 360}deg) scale(1)`, opacity: 1, offset: .55 },
      { transform: `translate(calc(-50% + ${dx * 1.15}px), calc(-50% + ${dy + 260}px)) rotate(${720}deg) scale(.6)`, opacity: 0 },
    ], { duration: 1500 + Math.random() * 900, easing: "cubic-bezier(.2,.7,.3,1)" }).onfinish = () => p.remove();
  }
}

// Full-screen "shaking the stocking" moment while names are drawn.
export async function drawCeremony(work) {
  const ov = document.createElement("div");
  ov.className = "ceremony";
  ov.append(mascot({ size: 190, mood: "wow", class: "shake-hard" }));
  const msg = document.createElement("div");
  msg.className = "ceremony-msg";
  msg.textContent = "Shaking the stocking…";
  ov.append(msg);
  const gifts = document.createElement("div");
  gifts.className = "tumble";
  gifts.innerHTML = "<span>🎁</span><span>🎄</span><span>🎁</span><span>⭐</span><span>🎁</span>";
  ov.append(gifts);
  document.body.append(ov);
  const minWait = new Promise((r) => setTimeout(r, reduceMotion() ? 300 : 1700));
  try {
    const [res] = await Promise.all([work(), minWait]);
    msg.textContent = "Ho ho ho! Names are drawn!";
    confetti(window.innerWidth / 2, window.innerHeight / 2, 120);
    await new Promise((r) => setTimeout(r, 900));
    return res;
  } finally {
    ov.classList.add("out");
    setTimeout(() => ov.remove(), 400);
  }
}
