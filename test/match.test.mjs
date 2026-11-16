import { drawMatches } from "../public/match.js";
let fails = 0;
function check(ids, k, bl, avoidMutual) {
  const t = Date.now();
  const r = drawMatches(ids, k, bl, { avoidMutual });
  if (!r.ok) return { ok: false, err: r.error };
  const inC = Object.fromEntries(ids.map(i => [i, 0]));
  const banned = new Set(bl.flatMap(p => [p.a + ">" + p.b, p.b + ">" + p.a]));
  for (const g of ids) {
    const rs = r.assignments[g];
    if (rs.length !== k) throw "out deg";
    if (new Set(rs).size !== k) throw "dup";
    for (const x of rs) { if (x === g) throw "self"; if (banned.has(g + ">" + x)) throw "blacklist"; inC[x]++; }
  }
  for (const i of ids) if (inC[i] !== k) throw "in deg";
  return { ok: true, mutual: r.mutualPairs, ms: Date.now() - t };
}
const P = n => Array.from({ length: n }, (_, i) => "p" + i);
// basic cases
for (const [n, k] of [[2,1],[3,1],[3,2],[5,1],[5,2],[8,3],[12,2],[30,3],[60,4]]) {
  const r = check(P(n), k, [], true); console.log(`n=${n} k=${k}`, r);
}
// couples blacklist
const ids = P(10);
const couples = [0,2,4,6,8].map(i => ({ a: "p"+i, b: "p"+(i+1) }));
console.log("couples k=1", check(ids, 1, couples, true));
console.log("couples k=2", check(ids, 2, couples, true));
console.log("couples k=8", check(ids, 8, couples, false));
console.log("couples k=9 (infeasible)", check(ids, 9, couples, false));
// tricky infeasible: 3 people, p0 blacklisted with p1, k=1 -> p0->p2, p1->p2? p2 receives 2. infeasible
console.log("3ppl blacklisted", check(P(3), 1, [{a:"p0",b:"p1"}], false));
// uniformity check: n=4,k=1 derangements = 9 -> each should be ~1/9
const counts = {};
for (let i = 0; i < 9000; i++) { const r = drawMatches(P(4), 1, [], {}); const key = P(4).map(p => r.assignments[p][0]).join(); counts[key] = (counts[key]||0)+1; }
console.log("derangement distribution", Object.values(counts).length, Object.values(counts).sort((a,b)=>a-b));
