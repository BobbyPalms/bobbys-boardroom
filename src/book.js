// THE BOOK: blackjack basic strategy (the chart the user supplied), as data the page draws and the hand checker reads.
// Columns are the dealer's upcard: 2 3 4 5 6 7 8 9 10 A.
export const UP = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "A"];
const row = s => s.split(" ");
export const HARD = [
  ["17+", row("S S S S S S S S S S")],
  ["16", row("S S S S S H H H H H")],
  ["15", row("S S S S S H H H H H")],
  ["14", row("S S S S S H H H H H")],
  ["13", row("S S S S S H H H H H")],
  ["12", row("H H S S S H H H H H")],
  ["11", row("D D D D D D D D D D")],
  ["10", row("D D D D D D D D H H")],
  ["9", row("H D D D D H H H H H")],
  ["8 or less", row("H H H H H H H H H H")],
];
export const SOFT = [
  ["A,9", row("S S S S S S S S S S")],
  ["A,8", row("S S S S Ds S S S S S")],
  ["A,7", row("Ds Ds Ds Ds Ds S S H H H")],
  ["A,6", row("H D D D D H H H H H")],
  ["A,5", row("H H D D D H H H H H")],
  ["A,4", row("H H D D D H H H H H")],
  ["A,3", row("H H H D D H H H H H")],
  ["A,2", row("H H H D D H H H H H")],
];
export const PAIRS = [
  ["A,A", row("Y Y Y Y Y Y Y Y Y Y")],
  ["T,T", row("N N N N N N N N N N")],
  ["9,9", row("Y Y Y Y Y N Y Y N N")],
  ["8,8", row("Y Y Y Y Y Y Y Y Y Y")],
  ["7,7", row("Y Y Y Y Y Y N N N N")],
  ["6,6", row("Y/N Y Y Y Y N N N N N")],
  ["5,5", row("N N N N N N N N N N")],
  ["4,4", row("N N N Y/N Y/N N N N N N")],
  ["3,3", row("Y/N Y/N Y Y Y Y N N N N")],
  ["2,2", row("Y/N Y/N Y Y Y Y N N N N")],
];
export const SURRENDER = [
  ["16", row("- - - - - - - SUR SUR SUR")],
  ["15", row("- - - - - - - - SUR -")],
  ["14", row("- - - - - - - - - -")],
];
export const KEY = [["H", "Hit"], ["S", "Stand"], ["D", "Double if allowed, otherwise hit"], ["Ds", "Double if allowed, otherwise stand"], ["N", "Don't split the pair"], ["Y", "Split the pair"], ["Y/N", "Split only if DAS (double after split) is offered"], ["SUR", "Surrender"]];
const WORD = { H: "Hit", S: "Stand", D: "Double (hit if you can't)", Ds: "Double (stand if you can't)" };

// The hand checker: a hand ("hard 16", "soft A,7", "pair 8,8") against an upcard -> what to do, and why
export function bookCall(hand, up, { das = true, surrender = true } = {}) {
  const c = UP.indexOf(up);
  if (c < 0) return null;
  const hardRow = t => HARD.find(([k]) => (t >= 17 ? k === "17+" : t <= 8 ? k === "8 or less" : k === String(t)))[1][c];
  if (hand.type === "pair") {
    const r = PAIRS.find(([k]) => k === hand.key)[1][c];
    const v = hand.key === "A,A" ? 12 : hand.key === "T,T" ? 20 : 2 * Number(hand.key[0]);
    if (r === "Y" || (r === "Y/N" && das)) return { act: "Split", code: r, note: r === "Y/N" ? "Split because double after split is offered." : "" };
    const asTotal = hand.key === "A,A" ? null : hardRow(v);
    return { act: WORD[asTotal] || "Stand", code: asTotal || "S", note: r === "Y/N" ? `No double after split here, so play it as a hard ${v}.` : `Don't split: play it as a hard ${v}.` };
  }
  if (hand.type === "soft") return { act: WORD[SOFT.find(([k]) => k === hand.key)[1][c]], code: SOFT.find(([k]) => k === hand.key)[1][c], note: "" };
  const t = hand.total;
  if (surrender && (t === 15 || t === 16)) { const s = SURRENDER.find(([k]) => k === String(t))[1][c]; if (s === "SUR") return { act: "Surrender", code: "SUR", note: "If surrender isn't offered, hit." }; }
  return { act: WORD[hardRow(t)], code: hardRow(t), note: "" };
}
