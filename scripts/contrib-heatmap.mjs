/**
 * 生成自托管的 GitHub 贡献热力图 SVG。
 * 不依赖任何第三方图床 / Vercel 服务，素材直接提交进仓库，README 用 raw 链接引用。
 *
 * 数据源优先级：
 *   1) GitHub GraphQL API（需要 GH_TOKEN / GITHUB_TOKEN，数据最准，含私有仓库贡献）
 *   2) https://github-contributions-api.jogruber.de/v4/<user>?y=last（免鉴权，实测可用）
 *   3) GitHub 公开事件 API（仅最近 90 天，兜底）
 *
 * 产物：
 *   assets/contrib-heatmap.svg   热力图（README 直接引用）
 *   assets/contrib-data.json     数据快照（便于二次开发）
 *
 * 用法：GH_TOKEN=xxx node scripts/contrib-heatmap.mjs        # 本地
 *      在 GitHub Actions 里会自动拿到 secrets.GITHUB_TOKEN
 */
import { writeFileSync, mkdirSync } from 'node:fs';

const LOGIN = process.env.GH_LOGIN || 'fomalhaut1998';
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
const OUT_DIR = 'assets';
const WINDOW_DAYS = 365;

const C = {
  canvas: '#0d1117',
  border: '#30363d',
  text: '#8b949e',
  strong: '#c9d1d9',
  empty: '#161b22',
  levels: ['#0e4429', '#006d32', '#26a641', '#39d353'],
};

const today = new Date();
const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
const start = new Date(end);
start.setUTCDate(start.getUTCDate() - (WINDOW_DAYS - 1));
const iso = (d) => d.toISOString().slice(0, 10);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function fromGraphQL() {
  if (!TOKEN) return null;
  const query = `query($login:String!,$from:DateTime!,$to:DateTime!){
    user(login:$login){
      contributionsCollection(from:$from,to:$to){
        contributionCalendar{
          totalContributions
          weeks{ contributionDays{ date contributionCount } }
        }
      }
    }
  }`;
  try {
    const res = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        authorization: `bearer ${TOKEN}`,
        'user-agent': 'contrib-heatmap',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        query,
        variables: { login: LOGIN, from: start.toISOString(), to: end.toISOString() },
      }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const days = json?.data?.user?.contributionsCollection?.contributionCalendar?.weeks
      ?.flatMap((w) => w.contributionDays)
      ?.map((d) => ({ date: d.date, count: d.contributionCount }));
    if (!days?.length) return null;
    return { source: 'graphql', days };
  } catch {
    return null;
  }
}

async function fromJogruber() {
  try {
    const res = await fetch(
      `https://github-contributions-api.jogruber.de/v4/${LOGIN}?y=last`,
      { headers: { 'user-agent': 'contrib-heatmap' } }
    );
    if (!res.ok) return null;
    const json = await res.json();
    const days = (json.contributions || []).map((d) => ({ date: d.date, count: d.count }));
    if (!days.length) return null;
    return { source: 'jogruber', days };
  } catch {
    return null;
  }
}

async function fromEvents() {
  const events = [];
  for (let page = 1; page <= 3; page++) {
    try {
      const res = await fetch(
        `https://api.github.com/users/${LOGIN}/events/public?per_page=100&page=${page}`,
        {
          headers: {
            'user-agent': 'contrib-heatmap',
            accept: 'application/vnd.github+json',
            ...(TOKEN ? { authorization: `bearer ${TOKEN}` } : {}),
          },
        }
      );
      if (!res.ok) break;
      const chunk = await res.json();
      if (!Array.isArray(chunk) || !chunk.length) break;
      events.push(...chunk);
    } catch {
      break;
    }
  }
  const map = new Map();
  for (const e of events) {
    if (e.type !== 'PushEvent') continue;
    const day = String(e.created_at).slice(0, 10);
    map.set(day, (map.get(day) || 0) + (e.payload?.size || 1));
  }
  const days = [...map.entries()].sort().map(([date, count]) => ({ date, count }));
  return days.length ? { source: 'events', days } : null;
}

const data = (await fromGraphQL()) || (await fromJogruber()) || (await fromEvents());
if (!data) {
  console.error('无法获取贡献数据，保持原图不变');
  process.exit(0);
}

const counts = new Map(data.days.map((d) => [d.date, d.count]));
const total = data.days.reduce((s, d) => s + d.count, 0);
const max = Math.max(1, ...data.days.map((d) => d.count));
const level = (n) => (n <= 0 ? 0 : n <= max * 0.25 ? 1 : n <= max * 0.5 ? 2 : n <= max * 0.75 ? 3 : 4);
const activeDays = data.days.filter((d) => d.count > 0).length;
const currentStreak = (() => {
  let s = 0;
  const d = new Date(end);
  while ((counts.get(iso(d)) || 0) > 0) { s++; d.setUTCDate(d.getUTCDate() - 1); }
  return s;
})();
const longestStreak = (() => {
  let best = 0, cur = 0;
  const d = new Date(start);
  while (d <= end) {
    if ((counts.get(iso(d)) || 0) > 0) { cur++; best = Math.max(best, cur); } else cur = 0;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return best;
})();
const bestDay = data.days.slice().sort((a, b) => b.count - a.count)[0] || { date: '', count: 0 };

const CELL = 11, GAP = 3, PAD = 26, LABEL = 20, HEAD = 62, FOOT = 54, ROWS = 7;
const spanDays = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
const firstColOffset = (() => { const d = new Date(start); return 6 - ((d.getUTCDay() + 6) % 7); })();
const colsNeeded = Math.ceil((firstColOffset + 1 + spanDays - 1) / 7);
const gridW = colsNeeded * (CELL + GAP) - GAP;
const width = PAD * 2 + LABEL + gridW;
const height = HEAD + ROWS * (CELL + GAP) - GAP + FOOT;

const cells = [];
for (let i = 0; i < spanDays; i++) {
  const d = new Date(start);
  d.setUTCDate(d.getUTCDate() + i);
  const pos = firstColOffset + 1 + i - 1;
  const col = Math.floor(pos / 7), row = pos % 7;
  cells.push({ x: PAD + LABEL + col * (CELL + GAP), y: HEAD + row * (CELL + GAP), n: counts.get(iso(d)) || 0, date: iso(d) });
}

const monthLabels = [];
const seen = new Set();
for (const c of cells) {
  const m = c.date.slice(0, 7);
  if (seen.has(m)) continue;
  seen.add(m);
  const d = new Date(`${c.date}T00:00:00Z`);
  if (d.getUTCDate() <= 7) monthLabels.push({ x: c.x, label: `${d.getUTCMonth() + 1}月` });
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(LOGIN)} 的 GitHub 贡献热力图">
  <style>
    .t{font:12px -apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;fill:${C.text}}
    .t2{font:600 15px -apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;fill:${C.strong}}
    .t3{font:11px -apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;fill:${C.text}}
  </style>
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="12" fill="${C.canvas}" stroke="${C.border}"/>
  <text x="${PAD}" y="28" class="t2">GitHub 贡献热力图</text>
  <text x="${width - PAD}" y="28" class="t3" text-anchor="end">近一年 · 数据源 ${esc(data.source)}</text>
  <text x="${PAD}" y="48" class="t">${total} 次贡献 · ${activeDays} 天有提交 · 当前连续 ${currentStreak} 天 · 最长 ${longestStreak} 天 · 最高单日 ${bestDay.count} 次</text>
  ${monthLabels.map((m) => `<text x="${m.x}" y="${HEAD - 6}" class="t3">${esc(m.label)}</text>`).join('')}
  ${[['一', 0], ['三', 2], ['五', 4]].map(([t, r]) => `<text x="${PAD + LABEL - 8}" y="${HEAD + r * (CELL + GAP) + CELL - 1}" class="t3" text-anchor="end">${t}</text>`).join('')}
  ${cells.map((c) => {
    const fill = c.n === 0 ? C.empty : C.levels[level(c.n) - 1];
    return `<rect x="${c.x}" y="${c.y}" width="${CELL}" height="${CELL}" rx="2.5" fill="${fill}"><title>${c.date}: ${c.n} 次</title></rect>`;
  }).join('')}
  <g transform="translate(${PAD}, ${height - 22})">
    <text x="0" y="9" class="t3">少</text>
    ${[0, 1, 2, 3, 4].map((i) => `<rect x="${20 + i * (CELL + GAP)}" y="0" width="${CELL}" height="${CELL}" rx="2.5" fill="${i === 0 ? C.empty : C.levels[i - 1]}"/>`).join('')}
    <text x="${20 + 5 * (CELL + GAP) + 2}" y="9" class="t3">多</text>
    <text x="${gridW}" y="9" class="t3" text-anchor="end">由 GitHub Actions 每日自动生成 · ${iso(end)}</text>
  </g>
</svg>`;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(`${OUT_DIR}/contrib-heatmap.svg`, svg);
writeFileSync(
  `${OUT_DIR}/contrib-data.json`,
  JSON.stringify(
    { generatedAt: new Date().toISOString(), source: data.source, total, activeDays, currentStreak, longestStreak, bestDay, max, days: data.days },
    null, 2
  )
);
console.log(`✔ ${OUT_DIR}/contrib-heatmap.svg  ${width}x${height}  总贡献 ${total}  活跃 ${activeDays} 天`);
