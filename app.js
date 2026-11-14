"use strict";
// Desk web app (plan B, read-only). Data lives at d/<private path>/; the path arrives once via #d=... and is kept in localStorage.
const KEY = "desk_d", CACHE = "desk_cache_v2", SEEN = "desk_seen_push", POLL_S = 30;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const money = n => Math.abs(n).toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2});
const usd = n => n == null || isNaN(n) ? "—" : (n < 0 ? "-$" : "$") + money(n);
const big = n => n == null ? "n/a" : n >= 1e9 ? "$" + (n / 1e9).toFixed(2) + "B" : n >= 1e6 ? "$" + (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? "$" + (n / 1e3).toFixed(1) + "K" : "$" + n.toFixed(0);
const sp = n => (n >= 0 ? "+" : "") + n.toFixed(2) + "%";
const price = p => p == null ? "—" : p >= 1 ? "$" + p.toFixed(4) : "$" + p.toPrecision(4);
const hm = ts => new Date(ts * 1000).toLocaleTimeString("en-GB", {hour: "2-digit", minute: "2-digit"});
const RMq = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const ICON = {
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>',
  bell: '<svg viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0"/></svg>',
  back: '<svg viewBox="0 0 24 24" style="width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:2.2"><path d="M15 5l-7 7 7 7"/></svg>',
};

// ---- one-time key capture ----
(function captureKey() {
  const m = location.hash.match(/(?:^#|&)d=([A-Za-z0-9]{32,})/);
  if (m) { localStorage.setItem(KEY, m[1]); history.replaceState(null, "", location.pathname + location.search + "#/home"); }
})();
const dataPath = () => localStorage.getItem(KEY);

// last good data (kept across reloads); err = last failure; retryAt = next poll
const D = {state: null, chart: null, activity: {}, agents: {}, coin: {}, audit: {}, account: null, settings: null};
let ERR = null, LASTOK = 0, RETRY_AT = 0, RANGE = "LIVE", LOADED = false, SEARCH = "";
try { const c = JSON.parse(localStorage.getItem(CACHE) || "{}"); Object.assign(D, c.D || {}); LASTOK = c.LASTOK || 0; } catch (e) {}

async function getJSON(name) {
  const r = await fetch(`d/${dataPath()}/${name}?t=${Date.now()}`, {cache: "no-store"});
  if (!r.ok) { const e = new Error("HTTP " + r.status); e.status = r.status; throw e; }
  return r.json();
}

function need() {
  const [tab, arg] = route();
  const n = ["state.json", "chart.json"];
  if (tab === "activity") n.push("activity/1.json"); else if (tab === "home") n.push("activity/1.json");
  if (tab === "agents") ["scanner", "auditor", "analyst", "executor", "risk"].forEach(a => n.push(`agents/${a}.json`));
  if (tab === "account") n.push("account.json", "settings.json");
  if (tab === "coin" && arg) n.push(`coin/${arg}.json`);
  if (tab === "audit") { const m = arg || lastAuditMint(); if (m) n.push(`audit/${m}.json`); }
  return n;
}
function store(name, j) {
  if (name === "state.json") D.state = j; else if (name === "chart.json") D.chart = j;
  else if (name === "account.json") D.account = j; else if (name === "settings.json") D.settings = j;
  else { const [k, f] = name.split("/"), id = f.replace(".json", ""); D[k === "agents" ? "agents" : k][id] = j; }
}

async function load() {
  if (!dataPath()) { render(); return; }
  try {
    const names = need();
    const res = await Promise.allSettled(names.map(getJSON));
    res.forEach((r, i) => { if (r.status === "fulfilled") store(names[i], r.value); else if (r.reason && r.reason.status === 404 && names[i].includes("/")) store(names[i], {missing: true}); });
    const core = res.slice(0, 2);
    if (core.some(r => r.status === "rejected")) throw core.find(r => r.status === "rejected").reason;
    // a desk that stops publishing is offline too
    const pm = (D.state.publishMin || 8) * 60;
    if (Date.now() / 1000 - D.state.ts > 2 * pm + 180) { ERR = "stale"; LASTOK = D.state.ts; }
    else { ERR = null; LASTOK = D.state.ts; }
    try { localStorage.setItem(CACHE, JSON.stringify({D: {state: D.state, chart: D.chart, activity: {"1": D.activity["1"]}, account: D.account, settings: D.settings}, LASTOK})); } catch (e) {}
  } catch (e) { ERR = e.message || String(e); }
  LOADED = true; RETRY_AT = Date.now() + POLL_S * 1000;
  render();
}
setInterval(() => { if (Date.now() >= RETRY_AT) load(); else errRow(); }, 1000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });

function errRow() {
  const el = $("#err");
  if (!ERR || !dataPath()) { el.classList.add("hidden"); return; }
  const n = Math.max(0, Math.ceil((RETRY_AT - Date.now()) / 1000));
  el.textContent = `Desk offline · retrying in ${n}s · last update ${LASTOK ? hm(LASTOK) : "never"}`;
  el.classList.remove("hidden");
}

// ---- routing ----
function route() { const p = (location.hash || "#/home").replace(/^#\/?/, "").split("/"); return [p[0] || "home", p[1] ? decodeURIComponent(p[1]) : null]; }
window.addEventListener("hashchange", () => { window.scrollTo(0, 0); render(); load(); });
const lastAuditMint = () => { const a = D.state && D.state.agents && D.state.agents.find(c => c.key === "auditor"); return a && a.last ? a.last.mint : null; };

// ---- odometer ----
function odometer(el, text) {
  const old = el.dataset.v || "", rm = RMq();
  if (old.length !== text.length || !el.children.length) {
    el.innerHTML = [...text].map(ch => /\d/.test(ch)
      ? `<span class="od"><span class="col">${[...Array(10).keys()].map(d => `<span>${d}</span>`).join("")}</span></span>`
      : `<span class="od ch"><span class="col"><span>${esc(ch)}</span></span></span>`).join("");
  }
  const cols = [...el.querySelectorAll(".col")], n = text.length;
  if (old.length === n && !rm) {  // start from the previous digits, then roll
    [...old].forEach((ch, i) => { if (/\d/.test(ch) && cols[i]) { cols[i].style.transition = "none"; cols[i].style.transform = `translateY(-${Number(ch) * 70}px)`; } });
    void el.offsetHeight; cols.forEach(c => c.style.transition = "");
  }
  [...text].forEach((ch, i) => {
    if (!/\d/.test(ch)) return;
    const c = cols[i], changed = old[i] !== ch;
    c.style.transitionDelay = rm || !changed ? "0ms" : ((n - 1 - i) * 30) + "ms";
    c.style.transform = `translateY(-${Number(ch) * 70}px)`;
  });
  el.dataset.v = text;
}

// ---- shared bits ----
const navbar = () => {
  const unread = D.state && D.state.lastPushId > Number(localStorage.getItem(SEEN) || 0);
  return `<div class="nav"><a class="avatar" href="#/account" aria-label="Account">R</a>
    <a class="navtitle" href="#/agents">Grok Bot<span class="chev">›</span></a><span class="spacer"></span>
    <button class="iconbtn" id="b-search" aria-label="Search">${ICON.search}</button>
    <button class="iconbtn" id="b-bell" aria-label="Alerts">${ICON.bell}${unread ? '<i class="dot"></i>' : ""}</button></div>`;
};
const backbar = (title, paper) => `<div class="nav"><a class="back" href="javascript:history.length>1?history.back():location.hash='#/home'">${ICON.back}Back</a>
  <span class="spacer"></span>${title ? `<b>${esc(title)}</b><span class="spacer"></span>` : ""}${paper ? '<span class="pill paper">PAPER</span>' : '<span style="width:56px"></span>'}</div>`;
const sk = (h, mt = 12) => `<div class="sk" style="height:${h}px;margin-top:${mt}px"></div>`;
const isPaper = () => !D.state || D.state.mode !== "LIVE";

function actRow(r) {
  const ic = {bought: "↗", sold: "$", stopped: "↓", rejected: "×"}[r.kind] || "•";
  const href = r.kind === "rejected" ? `#/audit/${r.mint}` : `#/coin/${r.mint}`;
  const vc = r.kind === "sold" && !String(r.value).startsWith("-") ? "up" : r.kind === "stopped" || String(r.value).startsWith("-") ? "down" : r.kind === "rejected" ? "sec" : "";
  return `<a class="row" href="${href}"><span class="ic ${esc(r.kind)}">${ic}</span><span class="main"><div class="t">${esc(r.title)}</div><div class="s">${esc(r.subtitle)}</div></span>
    <span class="v ${vc}">${esc(r.value)}</span></a>`;
}

// ---- agent cards (home carousel) ----
function cardHTML(c, i) {
  const st = c.paused ? "paused" : c.running ? "on" : "";
  let body = "", foot = "";
  if (c.key === "scanner") {
    body = c.feed && c.feed.length ? `<div class="feed">${c.feed.slice(0, 6).map(f => f.verdict === "pass"
      ? `<div class="fr pass"><span class="n">${esc(f.name)} · liq ${big(f.liq)}</span><span class="r">→ auditor</span></div>`
      : `<div class="fr kill"><span class="n">${esc(f.name)}</span><span class="r">${esc(f.reason)}</span></div>`).join("")}</div>`
      : `<div class="sec">Listening for graduations</div>`;
    foot = `<span>${c.waiting ? c.waiting + " waiting" : ""}</span><span>${hm(c.heartbeat || 0)}</span>`;
  } else if (c.key === "auditor") {
    const L = c.last ? c.last.layers : [];
    body = `<div class="strips">${[...Array(8).keys()].map(k => { const l = L.find(x => x.n === k + 1); return `<i class="strip ${l ? (l.pass === true ? "ok" : l.pass === false ? "bad" : "nc") : ""}"></i>`; }).join("")}</div>
      <div>${c.last ? `${esc(c.last.name)} · <span class="${c.last.passed ? "up" : c.last.done ? "down" : "sec"}">${esc(c.last.verdict)}</span>` : '<span class="sec">No coin taken apart yet</span>'}</div>`;
    foot = `<span>${esc(c.rejectedText)}</span><span></span>`;
  } else if (c.key === "analyst") {
    body = `<canvas class="ring" data-score="${c.last ? c.last.score : ""}" data-green="${c.greenFrom}"></canvas>
      <div style="text-align:center;margin-top:8px">${c.last ? `${esc(c.last.name)} · <span class="${c.last.pass ? "up" : "down"}">${esc(c.last.pass ? "pass" : c.last.reason)}</span>` : '<span class="sec">Waiting for a coin</span>'}</div>`;
  } else if (c.key === "executor") {
    const l = c.last;
    body = l ? `<div>${esc(l.name)}</div><div class="sec">${esc(l.text)}</div>
      <div class="bar"><i style="width:${l.filled ? 100 : 0}%"></i></div><div class="${l.filled ? "up" : "sec"}">${l.filled ? "✓ Filled" : l.status === "pushed" ? "Executing... 0%" : esc(l.status)}</div>`
      : `<div class="sec">No trades yet tonight</div>`;
    foot = `<span>${c.stackPct}% of stack per ticket</span><span></span>`;
  } else if (c.key === "risk") {
    body = `<div class="pills"><span class="pill mono red">${esc(c.stopPill)}</span><span class="pill mono green">${esc(c.trailPill)}</span></div>
      <div class="sec" style="margin-top:12px">${c.open ? c.open + " open position" + (c.open > 1 ? "s" : "") : "No open position"}</div>`;
  }
  return `<a class="acard" href="#/agents" style="border-radius:calc(42 * (100vw - 32px) / 504)"><div class="name"><i class="sdot ${st}"></i><span style="color:${c.color}">${esc(c.name)}</span></div>
    <div class="head">${esc(c.headline)}</div>${body}<div class="foot">${foot}</div></a>`;
}

// ---- screens ----
function home() {
  const s = D.state, ch = D.chart, a1 = D.activity["1"];
  if (!s || !ch) return navbar() + sk(70, 6) + sk(24) + sk(220) + sk(44) + sk(30, 22) + sk(260);
  const r = ch.ranges[RANGE] || {points: [], marks: []};
  const empty = !(s.agents.find(c => c.key === "executor") || {}).count && !r.marks.length;
  const rows = a1 && a1.rows ? a1.rows.slice(0, 5) : null;
  const q = SEARCH.trim().toLowerCase(), hits = q ? (s.coins || []).filter(c => [c.name, c.symbol, c.mint].some(v => v && v.toLowerCase().includes(q))).slice(0, 8) : [];
  return navbar() + `<div id="searchbox" class="${SEARCH === "" && !window._searchOpen ? "hidden" : ""}"><div class="search">${ICON.search.replace("<svg", '<svg width="18" height="18" style="fill:none;stroke:rgba(235,235,245,.6);stroke-width:2"')}<input id="q" placeholder="Name, symbol or mint" value="${esc(SEARCH)}" autocomplete="off"></div>
    ${q ? `<div class="list">${hits.length ? hits.map(c => `<a class="row" href="#/coin/${c.mint}"><span class="main"><div class="t">${esc(c.name)}</div><div class="s">${esc(c.symbol || "")} · ${esc(c.mint.slice(0, 4))}…${esc(c.mint.slice(-4))}</div></span><span class="chev-r">›</span></a>`).join("") : '<div class="emptytxt">No coin tonight matches</div>'}</div>` : ""}</div>
    <div class="bal"><div class="big" id="odo"></div>${s.mode !== "LIVE" ? '<span class="pill paper">PAPER</span>' : ""}</div>
    <div class="today"><span class="${s.todayPct >= 0 ? "up" : "down"}">${sp(s.todayPct)}</span><span class="pill mult">${s.multiplier.toFixed(2)}×</span><span class="sec" style="font-weight:400;font-size:13px">today</span></div>
    <div class="chart"><canvas id="lc"></canvas>${empty ? '<div class="empty-chart">Waiting for the first trade</div>' : ""}</div>
    <div class="ranges">${Object.keys(ch.ranges).map(k => `<button data-r="${k}" class="${k === RANGE ? "on" : ""}">${k}</button>`).join("")}</div>
    <div class="sec-h"><h2>Agents · ${s.running} running</h2></div>
    <div class="car">${s.agents.map(cardHTML).join("")}</div>
    <div class="sec-h"><h2>Activity</h2><a href="#/activity">See all</a></div>
    ${rows == null ? sk(280, 0) : rows.length ? `<div class="list">${rows.map(actRow).join("")}</div>` : '<div class="list"><div class="emptytxt">Nothing yet tonight</div></div>'}`;
}

function agentsTab() {
  const s = D.state;
  const head = `<div class="nav"><b style="font:700 34px var(--disp)">Agents</b></div>`;
  if (!s) return head + sk(200) + sk(200) + sk(200);
  return head + s.agents.map(c => {
    const d = D.agents[c.key], st = c.paused ? "paused" : c.running ? "on" : "";
    const locked = c.key === "risk" && c.locked;
    const decs = !d ? `<div class="sk" style="height:132px;margin:0 14px 14px"></div>` : d.decisions && d.decisions.length ? d.decisions.slice(0, 20).map(x => {
      const bad = /red|reject|skipped|kill|stop/.test(x.verdict), good = /pass|bought|trail/.test(x.verdict);
      const coin = (D.state.coins || []).find(k => k.mint === x.mint);
      return `<a class="dec" href="#/${c.key === "auditor" || bad && c.key !== "risk" ? "audit" : "coin"}/${x.mint}"><span class="tm">${hm(x.ts)}</span><span class="cn">${esc(coin ? coin.name : x.mint.slice(0, 6))}</span><span class="vd ${bad ? "bad" : good ? "good" : ""}">${esc(x.reason || x.verdict)}</span></a>`;
    }).join("") : `<div class="dec sec">${c.key === "scanner" ? "Listening for graduations" : "Nothing yet tonight"}</div>`;
    return `<div class="agent"><div class="top"><i class="sdot ${st}"></i><span class="t" style="color:${c.color}">${esc(c.name)}</span>
      <span class="cnt">${c.count ?? 0} today</span><span class="sw ${c.paused ? "" : "on"}" title="${locked ? "Locked while a position is open" : "Read-only in plan B"}"></span></div>
      ${decs}<a class="link-row" href="#/account">Settings<span class="chev-r">›</span></a></div>`;
  }).join("");
}

function activityTab() {
  const head = `<div class="nav"><b style="font:700 34px var(--disp)">Activity</b></div>`;
  const pages = Object.keys(D.activity).map(Number).sort((a, b) => a - b), p1 = D.activity["1"];
  if (!p1) return head + sk(420, 0);
  const rows = pages.flatMap(p => (D.activity[p] && D.activity[p].rows) || []);
  const more = p1.pages > pages[pages.length - 1];
  return head + (rows.length ? `<div class="list">${rows.map(actRow).join("")}</div>${more ? '<button class="btn" id="more" style="background:var(--card);color:var(--green)">Load more</button>' : ""}`
    : '<div class="list"><div class="emptytxt">Nothing yet tonight</div></div>');
}

function auditScreen(mint) {
  mint = mint || lastAuditMint();
  if (!D.state) return backbar("Auditor") + sk(250) + sk(380);
  if (!mint) return backbar("Auditor") + '<div class="emptytxt" style="margin-top:80px">No coin taken apart yet</div>';
  const a = D.audit[mint];
  if (!a) return backbar("Auditor") + sk(250) + sk(380);
  if (a.missing || !a.layers || !a.layers.length) return backbar("Auditor") + '<div class="emptytxt" style="margin-top:80px">No coin taken apart yet</div>';
  const L = [...Array(8).keys()].map(k => a.layers.find(l => l.n === k + 1));
  return backbar(a.name) + `<div class="discs" id="discs" data-mint="${esc(mint)}">${L.map((l, i) => `<i class="disc" data-final="${l ? (l.pass === true ? "ok" : l.pass === false ? "bad" : "nc") : ""}" style="z-index:${8 - i}"></i>`).join("")}<i class="beam hidden"></i></div>
    <div class="verdict"><div class="h ${a.verdict === "rejected" ? "bad" : a.verdict === "cleared" ? "good" : ""}">${esc(a.headline)}</div><div class="sec">${esc(a.sub)}</div></div>
    <div class="list">${L.map((l, i) => `<div class="row lrow"><span class="chk ${l ? (l.pass === true ? "ok" : l.pass === false ? "bad" : "nc") : "nc"}">${l && l.pass === true ? "✓" : l && l.pass === false ? "×" : "–"}</span>
      <span class="main"><div class="t">${i + 1} · ${esc(l ? l.name : "")}</div><div class="s">${esc(l ? l.source || "" : "")}</div></span><span class="v ${l && l.pass === false ? "down" : ""}">${esc(l ? l.value : "not checked")}</span></div>`).join("")}</div>
    <div class="list" style="margin-top:12px"><div class="set" style="min-height:52px"><span class="k">Take apart before buying</span><span class="sw ${a.enabled ? "on" : ""}" title="Read-only in plan B"></span></div></div>
    <a class="btn" href="${esc(a.link)}" target="_blank" rel="noopener">Open on FOMO</a>`;
}

function coinScreen(mint) {
  const c = D.coin[mint];
  if (!c) return backbar("", isPaper()) + sk(40) + sk(52) + sk(240) + sk(150);
  if (c.missing) return backbar("", isPaper()) + '<div class="emptytxt" style="margin-top:80px">This coin isn\'t on the desk tonight</div>';
  const p = c.position, x = c.exit, open = p && p.open;
  const since = p && p.sinceEntryPct != null ? `<div class="${p.sinceEntryPct >= 0 ? "up" : "down"}" style="font-weight:600">${p.sinceEntryPct >= 0 ? "▲" : "▼"} ${Math.abs(p.sinceEntryPct).toFixed(2)}% since entry</div>` : "";
  return backbar("", c.mode !== "LIVE") + `<div style="display:flex;align-items:center;gap:8px"><b style="font:700 28px var(--disp)">${esc(c.name)}</b>${c.shield ? `<span class="chip">⛨ ${esc(c.shield)}</span>` : ""}</div>
    <div class="sec">${esc(c.subtitle)}</div><div class="price">${price(c.price)}</div>${since}
    <div class="chart" style="height:240px;margin-top:10px"><canvas id="cc"></canvas></div>
    <div class="stats"><div><div class="k">Market cap</div><div class="val">${big(c.stats.marketCap)}</div></div><div><div class="k">Liquidity</div><div class="val">${big(c.stats.liquidityUsd)}</div></div>
      <div><div class="k">24h volume</div><div class="val">${big(c.stats.volume24)}</div></div><div><div class="k">Holders</div><div class="val">${c.stats.holders == null ? "n/a" : c.stats.holders.toLocaleString("en-US")}</div></div></div>
    ${p ? `<div class="pcard"><div class="k">Your position</div><div style="font-weight:600;font-size:17px;margin-top:2px">${esc(p.text)}</div>
      ${!open && p.pnlUsd != null ? `<div class="${p.pnlUsd >= 0 ? "up" : "down"}" style="margin-top:4px">Closed · ${esc(p.exitReason || "")} · ${p.pnlUsd >= 0 ? "+" : "-"}$${money(p.pnlUsd)}</div>` : ""}</div>` : ""}
    ${open && x ? `<div class="pcard"><div class="kv"><span class="k">Stop line</span><span>${price(x.stopPrice)} · -${+x.stopPct.toFixed(2)}%</span></div>
      <div class="kv"><span class="k">Trail line</span><span>${x.trailActive ? price(x.trailPrice) + " · " + x.trailPct + "% off the top" : "starts at " + price(x.trailPrice)}</span></div>
      <div class="kv"><span class="k">Time left to timeout</span><span>${Math.floor(x.timeoutLeftMin / 60)}h ${x.timeoutLeftMin % 60}m</span></div></div>` : ""}
    <a class="btn ${open ? "red" : ""}" href="${esc(c.link)}" target="_blank" rel="noopener">${open ? "Sell on FOMO" : "Buy on FOMO"}</a>`;
}

function accountTab() {
  const a = D.account, st = D.settings;
  const head = `<div class="nav"><b style="font:700 34px var(--disp)">Account</b></div>`;
  if (!a || !st) return head + sk(100) + sk(100) + sk(400);
  return head + `<div class="list"><div class="set"><span class="k">Mode</span><span class="${a.mode === "LIVE" ? "" : "pill paper"}">${esc(a.mode)}</span></div>
      <div class="set"><span class="k">Stack</span><span>${usd(a.stack)}</span></div>
      ${a.ticketCheck ? `<div class="set" style="min-height:auto;padding:10px 14px"><span class="sec" style="font-size:13px">${esc(a.ticketCheck.message)}</span></div>` : ""}</div>
    <div class="list" style="margin-top:12px"><a class="set" href="${esc(a.profileUrl)}" target="_blank" rel="noopener"><span class="k">Your FOMO profile</span><span class="chev-r">›</span></a>
      <a class="set" href="#" id="invite" data-url="${esc(a.signupUrl)}"><span class="k">Invite a friend</span><span class="chev-r">›</span></a>
      <div class="set"><span class="k">Alerts</span><span class="sec">${esc(a.alerts)}</span></div></div>
    <div class="note">iPhone notifications aren't available in plan B. Alerts arrive in Discord.</div>
    ${Object.entries(st.groups).map(([g, items]) => `<div class="grp">${esc(g[0].toUpperCase() + g.slice(1))}</div><div class="list">${items.map(i => `<div class="set"><span class="k">${esc(i.key)}</span><span class="val">${esc(i.text)}</span></div>`).join("")}</div>`).join("")}
    <div class="note">Settings are read-only here. Change them in the Grok Bot chat, e.g. "set stop to -8%".</div>`;
}

function noLink() {
  return `<div class="nav"><b style="font:700 34px var(--disp)">Desk</b></div><div class="card" style="padding:20px;margin-top:20px">
    <div style="font-weight:600;font-size:17px">Open your private desk link once</div>
    <div class="sec" style="margin-top:6px">Ask Grok Bot in chat for your desk link and open it on this iPhone. After that, this app remembers it.</div></div>`;
}

// ---- render ----
function render() {
  const [tab, arg] = route(), v = $("#view");
  document.querySelectorAll("#tabs a").forEach(a => a.classList.toggle("on", a.dataset.tab === tab || (tab === "coin" || tab === "audit") && a.dataset.tab === "home"));
  if (!dataPath()) { v.innerHTML = noLink(); errRow(); return; }
  const fx = document.activeElement && document.activeElement.id === "q";
  const car = $(".car"), carX = car ? car.scrollLeft : 0, sy = window.scrollY;
  v.innerHTML = tab === "agents" ? agentsTab() : tab === "activity" ? activityTab() : tab === "account" ? accountTab()
    : tab === "coin" ? coinScreen(arg) : tab === "audit" ? auditScreen(arg) : home();
  errRow();
  if ($(".car")) $(".car").scrollLeft = carX;
  window.scrollTo(0, sy);
  if (fx) { const q = $("#q"); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  const s = D.state;
  if (tab === "home" && s && D.chart) {
    const odo = $("#odo"); if (odo) { odo.dataset.v = window._odo || ""; odometer(odo, usd(s.balance)); window._odo = usd(s.balance); }
    const r = D.chart.ranges[RANGE] || {points: [], marks: []};
    lineChart($("#lc"), r.points, D.chart.start, r.marks);
    document.querySelectorAll("canvas.ring").forEach(c => scoreRing(c, c.dataset.score === "" ? null : Number(c.dataset.score), Number(c.dataset.green)));
  }
  if (tab === "coin" && D.coin[arg] && !D.coin[arg].missing) candleChart($("#cc"), D.coin[arg].candles, D.coin[arg].exit ? D.coin[arg].exit.exitLine : null);
  if (tab === "audit") beam();
}

// audit beam: 350ms per layer top to bottom, then 150ms to green/red. Runs once per coin; never shows a result not in the data.
const BEAMED = new Set();
function beam() {
  const box = $("#discs"); if (!box) return;
  const discs = [...box.querySelectorAll(".disc")], b = box.querySelector(".beam"), m = box.dataset.mint;
  const finish = () => discs.forEach(d => d.dataset.final && d.classList.add(d.dataset.final));
  if (RMq() || BEAMED.has(m)) { finish(); return; }
  BEAMED.add(m); b.classList.remove("hidden");
  const n = discs.filter(d => d.dataset.final && d.dataset.final !== "nc").length || 1;
  let i = 0;
  const step = () => {
    if (i >= n) { b.classList.add("hidden"); setTimeout(finish, 0); return; }
    const d = discs[i], top = d.offsetTop + d.offsetHeight / 2 - 2;
    b.style.transition = "none"; b.style.top = top + "px";
    requestAnimationFrame(() => { setTimeout(() => { if (d.dataset.final) { d.style.transition = "background 150ms"; d.classList.add(d.dataset.final); } i++; step(); }, 350); });
  };
  step();
}

// ---- events ----
document.addEventListener("click", async e => {
  const t = e.target.closest("button, a"); if (!t) return;
  if (t.dataset.r) { RANGE = t.dataset.r; render(); return; }
  if (t.id === "b-search") { window._searchOpen = !window._searchOpen; if (!window._searchOpen) SEARCH = ""; render(); const q = $("#q"); if (q) q.focus(); return; }
  if (t.id === "b-bell") { bell(); return; }
  if (t.id === "more") { const n = Object.keys(D.activity).length + 1; try { D.activity[n] = await getJSON(`activity/${n}.json`); } catch (er) {} render(); return; }
  if (t.id === "invite") {
    e.preventDefault(); const url = t.dataset.url;
    if (navigator.share) { try { await navigator.share({title: "FOMO", url}); return; } catch (er) { if (er.name === "AbortError") return; } }
    try { await navigator.clipboard.writeText(url); } catch (er) { const i = document.createElement("textarea"); i.value = url; document.body.appendChild(i); i.select(); document.execCommand("copy"); i.remove(); }
    toast("Link copied");
  }
});
document.addEventListener("input", e => { if (e.target.id === "q") { SEARCH = e.target.value; render(); } });
function toast(t) { const d = document.createElement("div"); d.className = "toast"; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 1800); }
function bell() {
  const s = D.state, sh = $("#sheet"); if (!s) return;
  localStorage.setItem(SEEN, String(s.lastPushId || 0));
  sh.innerHTML = `<div class="in"><div class="grab"></div><div style="padding:0 16px 8px;font:700 22px var(--disp)">Alerts</div><div class="list" style="margin:0 12px">${(s.pushes || []).length
    ? s.pushes.map(p => `<a class="row" href="${p.mint ? "#/coin/" + p.mint : "#/home"}"><span class="main"><div class="t" style="white-space:normal">${esc(p.text.split("\n")[0])}</div><div class="s">${hm(p.ts)}</div></span></a>`).join("")
    : '<div class="emptytxt">No alerts yet tonight</div>'}</div></div>`;
  sh.classList.remove("hidden");
  sh.onclick = ev => { if (ev.target === sh || ev.target.closest("a")) { sh.classList.add("hidden"); render(); } };
}
window.addEventListener("resize", () => render());

if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
render(); load();
