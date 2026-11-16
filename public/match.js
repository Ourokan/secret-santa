// Secret Santa matching engine.
// Every person gives exactly k gifts and receives exactly k gifts,
// never to themselves, never across a blacklisted pair, never the same
// person twice. Optionally minimises mutual pairs (A->B and B->A).

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function buildAllowed(ids, blacklist) {
  const n = ids.length;
  const idx = new Map(ids.map((id, i) => [id, i]));
  const allowed = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => i !== j)
  );
  for (const p of blacklist || []) {
    const a = idx.get(p.a), b = idx.get(p.b);
    if (a === undefined || b === undefined) continue;
    allowed[a][b] = false;
    if (!p.oneWay) allowed[b][a] = false;
  }
  return allowed;
}

// Quick, human-readable reasons a draw can't work (not exhaustive; the
// flow check below is the real test).
export function diagnose(ids, k, blacklist, names = {}) {
  const n = ids.length;
  const problems = [];
  if (n < 2) problems.push("You need at least 2 people.");
  if (k < 1) problems.push("Matches per person must be at least 1.");
  if (k > n - 1) problems.push(`With ${n} people, each person can have at most ${n - 1} match${n - 1 === 1 ? "" : "es"}.`);
  if (problems.length) return problems;
  const allowed = buildAllowed(ids, blacklist);
  ids.forEach((id, i) => {
    const out = allowed[i].filter(Boolean).length;
    const inn = allowed.reduce((s, row) => s + (row[i] ? 1 : 0), 0);
    const nm = names[id] || "Someone";
    if (out < k) problems.push(`${nm} can only give to ${out} ${out === 1 ? "person" : "people"} after the blacklist, but needs ${k}.`);
    else if (inn < k) problems.push(`Only ${inn} ${inn === 1 ? "person" : "people"} can give to ${nm} after the blacklist, but they need ${k}.`);
  });
  if (problems.length > 3) return [...problems.slice(0, 3), `…and ${problems.length - 3} more.`];
  return problems;
}

// Find any k-regular assignment via augmenting paths (bipartite b-matching).
function findAssignment(allowed, k, rng) {
  const n = allowed.length;
  const x = Array.from({ length: n }, () => new Array(n).fill(false));
  const outDeg = new Array(n).fill(0);
  const inDeg = new Array(n).fill(0);
  const order = shuffle([...Array(n).keys()], rng);
  const recvOrder = Array.from({ length: n }, () => shuffle([...Array(n).keys()], rng));

  for (let round = 0; round < k; round++) {
    for (const g of order) {
      if (outDeg[g] >= k) continue;
      // BFS over: giver --(x=0, allowed)--> receiver --(x=1)--> giver ...
      const prevGiverOfRecv = new Array(n).fill(-1);
      const prevRecvOfGiver = new Array(n).fill(-1);
      const seenG = new Array(n).fill(false);
      const seenR = new Array(n).fill(false);
      seenG[g] = true;
      let queue = [g];
      let end = -1;
      while (queue.length && end < 0) {
        const next = [];
        for (const gi of queue) {
          for (const r of recvOrder[gi]) {
            if (seenR[r] || !allowed[gi][r] || x[gi][r]) continue;
            seenR[r] = true;
            prevGiverOfRecv[r] = gi;
            if (inDeg[r] < k) { end = r; break; }
            for (const g2 of order) {
              if (!seenG[g2] && x[g2][r]) {
                seenG[g2] = true;
                prevRecvOfGiver[g2] = r;
                next.push(g2);
              }
            }
          }
          if (end >= 0) break;
        }
        queue = next;
      }
      if (end < 0) continue;
      // Flip the path.
      let r = end;
      inDeg[end]++;
      while (true) {
        const gi = prevGiverOfRecv[r];
        x[gi][r] = true;
        if (gi === g) break;
        const rPrev = prevRecvOfGiver[gi];
        x[gi][rPrev] = false;
        r = rPrev;
      }
      outDeg[g]++;
    }
  }
  const total = outDeg.reduce((a, b) => a + b, 0);
  return total === n * k ? x : null;
}

function edgesOf(x) {
  const e = [];
  for (let i = 0; i < x.length; i++) for (let j = 0; j < x.length; j++) if (x[i][j]) e.push([i, j]);
  return e;
}

function mutualCount(x) {
  let c = 0;
  for (let i = 0; i < x.length; i++) for (let j = i + 1; j < x.length; j++) if (x[i][j] && x[j][i]) c++;
  return c;
}

function mutualAround(x, nodes) {
  // count mutual pairs that touch any of `nodes` (each pair once)
  const seen = new Set();
  let c = 0;
  for (const a of nodes) {
    for (let b = 0; b < x.length; b++) {
      if (a === b || !x[a][b] || !x[b][a]) continue;
      const key = a < b ? a + "," + b : b + "," + a;
      if (seen.has(key)) continue;
      seen.add(key);
      c++;
    }
  }
  return c;
}

// Edge-swap Markov chain: (a->b, c->d) => (a->d, c->b). Keeps every
// in/out degree fixed, so balance is preserved while randomising.
function trySwap(x, allowed, edges, rng, scoreFn) {
  const i1 = Math.floor(rng() * edges.length);
  const i2 = Math.floor(rng() * edges.length);
  if (i1 === i2) return false;
  const [a, b] = edges[i1];
  const [c, d] = edges[i2];
  if (a === c || b === d) return false;
  if (!allowed[a][d] || !allowed[c][b] || x[a][d] || x[c][b]) return false;
  const nodes = [a, b, c, d];
  const before = scoreFn ? mutualAround(x, nodes) : 0;
  x[a][b] = false; x[c][d] = false; x[a][d] = true; x[c][b] = true;
  if (scoreFn) {
    const after = mutualAround(x, nodes);
    if (!scoreFn(after - before)) {
      x[a][d] = false; x[c][b] = false; x[a][b] = true; x[c][d] = true;
      return false;
    }
  }
  edges[i1] = [a, d];
  edges[i2] = [c, b];
  return true;
}

/**
 * @param {string[]} ids participant ids
 * @param {number} k matches per person
 * @param {{a:string,b:string,oneWay?:boolean}[]} blacklist
 * @param {{avoidMutual?:boolean, rng?:() => number}} opts
 * @returns {{ok:true, assignments:Record<string,string[]>, mutualPairs:number} | {ok:false, error:string}}
 */
export function drawMatches(ids, k, blacklist = [], opts = {}) {
  const rng = opts.rng || (() => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32);
  const pre = diagnose(ids, k, blacklist, opts.names);
  if (pre.length) return { ok: false, error: pre.join(" ") };
  const allowed = buildAllowed(ids, blacklist);
  const x = findAssignment(allowed, k, rng);
  if (!x) {
    return {
      ok: false,
      error: "There's no way to give everyone the same number of matches with this blacklist. Remove some blacklisted pairs or lower the matches per person.",
    };
  }
  const n = ids.length;
  const edges = edgesOf(x);
  // 1) Randomise thoroughly.
  const mixSteps = Math.max(2000, 60 * edges.length);
  for (let s = 0; s < mixSteps; s++) trySwap(x, allowed, edges, rng, null);
  // 2) Reduce mutual pairs without breaking anything else.
  if (opts.avoidMutual) {
    let m = mutualCount(x);
    const floor = Math.max(0, n * k - (n * (n - 1)) / 2); // unavoidable mutual pairs
    for (let s = 0; s < 40 * mixSteps && m > floor; s++) {
      if (trySwap(x, allowed, edges, rng, (delta) => delta <= 0)) m = mutualCount(x);
    }
  }
  const assignments = {};
  for (let i = 0; i < n; i++) {
    assignments[ids[i]] = [];
    for (let j = 0; j < n; j++) if (x[i][j]) assignments[ids[i]].push(ids[j]);
    shuffle(assignments[ids[i]], rng);
  }
  return { ok: true, assignments, mutualPairs: mutualCount(x) };
}
