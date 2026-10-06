/**
 * 生成自托管的 GitHub 数据卡片 SVG（不依赖 github-readme-stats 等 Vercel 服务）。
 *
 * 数据源：
 *   - GitHub REST API：跟随者、公开仓库、Star/复刻总数（需 GH_TOKEN，否则容易触发限流）
 *   - assets/contrib-data.json：由 contrib-heatmap.mjs 生成的贡献快照（可选，没有就隐藏那行）
 *
 * 用法：GH_TOKEN=xxx node scripts/github-stats.mjs
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';

const LOGIN = process.env.GH_LOGIN || 'fomalhaut1998';
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
const OUT_DIR = 'assets';
const DATA_FILE = `${OUT_DIR}/contrib-data.json`;

const C = {
  canvas: '#0d1117',
  border: '#30363d',
  text: '#8b949e',
  strong: '#c9d1d9',
  accent: '#2d9c72',
  accent2: '#39d353',
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const headers = {
  'user-agent': 'github-stats-card',
  accept: 'application/vnd.github+json',
  ...(TOKEN ? { authorization: `bearer ${TOKEN}` } : {}),
};

async function api(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

const user = await api(`https://api.github.com/users/${LOGIN}`);
const repos = [];
for (let page = 1; page <= 3; page++) {
  const chunk = await api(`https://api.github.com/users/${LOGIN}/repos?per_page=100&page=${page}&sort=updated`);
  if (!Array.isArray(chunk) || !chunk.length) break;
  repos.push(...chunk);
}
const owned = repos.filter((r) => !r.fork);
const stars = owned.reduce((s, r) => s + r.stargazers_count, 0);
const forks = owned.reduce((s, r) => s + r.forks_count, 0);

let contrib = null;
if (existsSync(DATA_FILE)) {
  try { contrib = JSON.parse(readFileSync(DATA_FILE, 'utf8')); } catch { contrib = null; }
}

const stats = [
  { label: '总 Star', value: stars },
  { label: '关注者', value: user.followers },
  { label: '公开仓库', value: user.public_repos },
  { label: 'Fork', value: forks },
];
if (contrib) {
  stats[3] = { label: '近一年贡献', value: contrib.total ?? 0 };
}

const W = 811;
const PAD = 26;
const CARD_W = (W - PAD * 2 - 16 * (stats.length - 1)) / stats.length;
const HEAD = 56;
const ROW = 62;
const H = HEAD + ROW + (contrib ? 30 : 0) + 34;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(LOGIN)} 的 GitHub 数据">
  <style>
    .t{font:12px -apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;fill:${C.text}}
    .t2{font:600 15px -apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;fill:${C.strong}}
    .v{font:600 26px -apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;fill:${C.strong}}
    .l{font:12px -apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;fill:${C.text}}
    .a{font:600 13px -apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;fill:${C.accent2}}
  </style>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12" fill="${C.canvas}" stroke="${C.border}"/>
  <text x="${PAD}" y="33" class="t2">${esc(user.name || LOGIN)} 的 GitHub 数据</text>
  <text x="${W - PAD}" y="33" class="t" text-anchor="end">数据源 GitHub REST API</text>
  <line x1="${PAD}" y1="${HEAD - 14}" x2="${W - PAD}" y2="${HEAD - 14}" stroke="${C.border}"/>
  ${stats.map((s, i) => {
    const x = PAD + i * (CARD_W + 16);
    return `<g>
      <rect x="${x}" y="${HEAD}" width="${CARD_W}" height="${ROW - 10}" rx="9" fill="#161b22" stroke="${C.border}"/>
      <text x="${x + 14}" y="${HEAD + 26}" class="v">${esc(s.value)}</text>
      <text x="${x + 14}" y="${HEAD + 44}" class="l">${esc(s.label)}</text>
    </g>`;
  }).join('')}
  ${contrib ? `<text x="${PAD}" y="${HEAD + ROW + 18}" class="t">近一年 <tspan class="a">${contrib.total ?? 0}</tspan> 次贡献 · <tspan class="a">${contrib.activeDays ?? 0}</tspan> 天有提交 · 最长连续 <tspan class="a">${contrib.longestStreak ?? 0}</tspan> 天</text>` : ''}
  <text x="${W - PAD}" y="${H - 16}" class="t" text-anchor="end">由 GitHub Actions 自动更新</text>
</svg>`;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(`${OUT_DIR}/github-stats.svg`, svg);
console.log(`✔ ${OUT_DIR}/github-stats.svg  ${W}x${H}  Star ${stars}  关注者 ${user.followers}`);
