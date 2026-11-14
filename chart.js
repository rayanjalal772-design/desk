"use strict";
// Canvas charts (devicePixelRatio aware). No libraries.
const RM = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
const COL = {green: "#00d35a", red: "#ff453a", blue: "#0a84ff", orange: "#ff9f0a", sec: "rgba(235,235,245,0.6)", ter: "rgba(235,235,245,0.3)", sep: "rgba(84,84,88,0.55)"};
const FONT = '600 12px -apple-system,"SF Pro Text",sans-serif';

function setup(canvas) {
  const dpr = window.devicePixelRatio || 1, W = canvas.clientWidth, H = canvas.clientHeight;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
  const g = canvas.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  return [g, W, H];
}

// Home line chart. pts: [[ts, value]], start: night start balance, marks: [{ts,text,color}]
const LC = new WeakMap();
function lineChart(canvas, pts, start, marks) {
  const prev = LC.get(canvas), key = JSON.stringify(pts.slice(-1)), mkey = (marks || []).map(m => m.ts + m.text);
  const slide = prev && prev.key !== key && prev.n > 1 && pts.length > 1 && !RM();
  const fresh = new Set(prev ? mkey.filter(k => !prev.mkeys.has(k)) : (RM() ? [] : mkey));
  LC.set(canvas, {key, n: pts.length, mkeys: new Set(mkey)});
  const t0 = performance.now();
  const frame = now => {
    const a = slide ? Math.min(1, (now - t0) / 250) : 1, ma = RM() ? 1 : Math.min(1, (now - t0) / 200);
    draw(a, ma);
    if (a < 1 || ma < 1) requestAnimationFrame(frame);
  };
  const draw = (a, ma) => {
    const [g, W, H] = setup(canvas);
    const padT = 62, padB = 10, padX = 0;
    const ys = pts.map(p => p[1]).concat(start != null ? [start] : []);
    if (!ys.length) return;
    let lo = Math.min(...ys), hi = Math.max(...ys);
    if (hi - lo < 1e-9) { const d = Math.abs(hi) * 0.01 || 1; hi += d; lo -= d; }
    const x0 = pts.length ? pts[0][0] : 0, x1 = pts.length > 1 ? pts[pts.length - 1][0] : x0 + 1;
    const X = t => padX + (t - x0) / (x1 - x0 || 1) * (W - 2 * padX), Y = v => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
    if (start != null) { g.setLineDash([4, 4]); g.strokeStyle = COL.ter; g.lineWidth = 1; g.beginPath(); g.moveTo(0, Y(start)); g.lineTo(W, Y(start)); g.stroke(); g.setLineDash([]); }
    if (pts.length < 2) return;
    // slide: last point travels from previous last to its spot
    const P = pts.map(p => [X(p[0]), Y(p[1])]);
    if (a < 1) { const n = P.length - 1, b = P[n - 1]; P[n] = [b[0] + (P[n][0] - b[0]) * a, b[1] + (P[n][1] - b[1]) * a]; }
    const grad = g.createLinearGradient(0, padT, 0, H);
    grad.addColorStop(0, "rgba(0,211,90,0.28)"); grad.addColorStop(1, "rgba(0,211,90,0)");
    g.beginPath(); P.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]));
    g.lineTo(P[P.length - 1][0], H); g.lineTo(P[0][0], H); g.closePath(); g.fillStyle = grad; g.fill();
    g.beginPath(); P.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]));
    g.strokeStyle = COL.green; g.lineWidth = 2; g.lineJoin = "round"; g.stroke();
    // marks above the line; a later mark that would overlap moves up a row
    g.font = FONT; const rows = [];
    (marks || []).filter(m => m.ts >= x0 && m.ts <= x1).sort((p, q) => p.ts - q.ts).forEach(m => {
      const mx = X(m.ts), w = g.measureText(m.text).width + 16;
      let left = Math.max(0, Math.min(W - w, mx - w / 2)), r = 0;
      while ((rows[r] || []).some(([l, rr]) => left < rr + 4 && left + w > l - 4)) r++;
      (rows[r] = rows[r] || []).push([left, left + w]);
      const iy = pts.reduce((b, p) => Math.abs(p[0] - m.ts) < Math.abs(b[0] - m.ts) ? p : b, pts[0]);
      const ly = Math.min(Y(iy[1]) - 10, padT - 6) - r * 24, c = COL[m.color] || COL.sec;
      g.globalAlpha = fresh.has(m.ts + m.text) ? ma : 1;
      g.fillStyle = c; g.beginPath(); g.roundRect ? g.roundRect(left, ly - 18, w, 20, 10) : g.rect(left, ly - 18, w, 20); g.fill();
      g.fillStyle = m.color === "blue" || m.color === "red" ? "#fff" : "#000"; g.textBaseline = "middle"; g.fillText(m.text, left + 8, ly - 8);
      g.strokeStyle = c; g.lineWidth = 1; g.beginPath(); g.moveTo(mx, ly + 2); g.lineTo(mx, Y(iy[1])); g.stroke();
      g.globalAlpha = 1;
    });
  };
  requestAnimationFrame(frame);
}

// Coin candles with volume bars and orange dashed exit line ("Risk trailing stop")
function candleChart(canvas, cs, exitLine) {
  const [g, W, H] = setup(canvas);
  const vH = 40, padT = 10, padB = vH + 8, padR = 4;
  if (!cs || !cs.length) { g.fillStyle = COL.sec; g.font = '15px -apple-system,sans-serif'; g.textAlign = "center"; g.fillText("No price yet", W / 2, H / 2); return; }
  let lo = Math.min(...cs.map(c => c.l)), hi = Math.max(...cs.map(c => c.h));
  if (exitLine) { lo = Math.min(lo, exitLine); hi = Math.max(hi, exitLine); }
  if (hi - lo < hi * 1e-6) { hi *= 1.01; lo *= 0.99; }
  const n = Math.max(cs.length, 30), cw = (W - padR) / n, Y = v => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  const vmax = Math.max(...cs.map(c => c.v || 0), 1e-9);
  cs.forEach((c, i) => {
    const x = i * cw + cw / 2, col = c.c >= c.o ? COL.green : COL.red;
    g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 1;
    g.beginPath(); g.moveTo(x, Y(c.h)); g.lineTo(x, Y(c.l)); g.stroke();
    const top = Y(Math.max(c.o, c.c)), bh = Math.max(1, Math.abs(Y(c.o) - Y(c.c)));
    g.fillRect(x - cw * 0.35, top, cw * 0.7, bh);
    const vh = (c.v || 0) / vmax * vH; g.globalAlpha = 0.45; g.fillRect(x - cw * 0.35, H - vh, cw * 0.7, vh); g.globalAlpha = 1;
  });
  if (exitLine) {
    const y = Y(exitLine); g.setLineDash([5, 4]); g.strokeStyle = COL.orange; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); g.setLineDash([]);
    g.font = FONT; g.fillStyle = COL.orange; g.textBaseline = "bottom"; g.fillText("Risk trailing stop", 4, y - 3);
  }
}

// Score ring 0-100, green from greenFrom
function scoreRing(canvas, score, greenFrom) {
  const [g, W, H] = setup(canvas), r = Math.min(W, H) / 2 - 8, cx = W / 2, cy = H / 2;
  g.lineWidth = 10; g.lineCap = "round"; g.strokeStyle = "#2c2c2e";
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
  if (score == null) return;
  g.strokeStyle = score >= greenFrom ? COL.green : COL.red;
  g.beginPath(); g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, Math.min(100, score)) / 100); g.stroke();
  g.fillStyle = "#fff"; g.font = '700 34px -apple-system,"SF Pro Display",sans-serif'; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(String(score), cx, cy + 1);
}
