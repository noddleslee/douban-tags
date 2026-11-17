// 读取你的豆瓣清单：逐页请求列表页，带随机延迟和断点续传。
import { parseListPage } from './listpage.js';
import { loadItems, saveItems, loadMeta, saveMeta } from './store.js';

export const LISTS = [
  { type: 'movie', status: 'wish' },
  { type: 'book', status: 'wish' },
  { type: 'movie', status: 'collect' },
  { type: 'book', status: 'collect' },
  { type: 'movie', status: 'do' },
  { type: 'book', status: 'do' },
];

const PAGE_SIZE = 15;
const DELAY_MIN = 2000;
const DELAY_MAX = 5000;
const COOLDOWN_EVERY = 10;
const COOLDOWN_MS = 30000;

export class SyncError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const listKey = (l) => `${l.type}:${l.status}`;

function listUrl(uid, l, start) {
  return `https://${l.type}.douban.com/people/${encodeURIComponent(uid)}/${l.status}`
    + `?start=${start}&sort=time&rating=all&filter=all&mode=grid`;
}

async function sleep(ms, shouldStop) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (shouldStop()) return;
    await new Promise((r) => setTimeout(r, Math.min(500, end - Date.now())));
  }
}

async function fetchPage(url) {
  let res;
  try {
    res = await fetch(url, { credentials: 'include' });
  } catch (e) {
    throw new SyncError('NETWORK', '网络请求失败，请检查网络后重试');
  }
  if (/accounts\.douban\.com|passport/.test(res.url)) {
    throw new SyncError('NEED_LOGIN', '需要先在这个浏览器里登录豆瓣');
  }
  if (/sec\.douban\.com/.test(res.url) || [403, 418, 429].includes(res.status)) {
    throw new SyncError('RATE_LIMIT', '豆瓣暂时限制了访问。请过半小时再点"继续"，进度会保留');
  }
  if (!res.ok) throw new SyncError('HTTP', `豆瓣返回了错误（${res.status}），请稍后重试`);
  return res.text();
}

// 识别当前登录用户的豆瓣 ID：/mine/ 会跳转到 /people/<ID>/
export async function detectUid() {
  try {
    const res = await fetch('https://www.douban.com/mine/', { credentials: 'include' });
    const m = res.url.match(/\/people\/([^/?#]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

export function parseUidInput(input) {
  const s = String(input || '').trim();
  const m = s.match(/\/people\/([^/?#\s]+)/);
  if (m) return decodeURIComponent(m[1]);
  return /^[A-Za-z0-9_.-]+$/.test(s) ? s : null;
}

// mode: 'full' 全量（会清理已取消标记的条目）；'update' 只读每个清单最新的几页
export async function runSync({ uid, mode = 'full', onProgress = () => {}, shouldStop = () => false }) {
  let meta = await loadMeta();
  let progress = meta.progress && meta.progress.uid === uid && meta.progress.mode === mode
    ? meta.progress
    : { uid, mode, listIdx: 0, start: 0, seen: {}, pages: 0, startedAt: Date.now() };

  const items = await loadItems();
  const totals = meta.totals || {};

  for (; progress.listIdx < LISTS.length; progress.listIdx++, progress.start = 0) {
    const l = LISTS[progress.listIdx];
    const lk = listKey(l);
    const seen = new Set(progress.seen[lk] || []);
    let listDone = false;

    while (!listDone) {
      if (shouldStop()) {
        await saveMeta({ progress });
        return { stopped: true };
      }
      onProgress({ list: l, start: progress.start, total: totals[lk], pages: progress.pages, count: Object.keys(items).length });

      const html = await fetchPage(listUrl(uid, l, progress.start)).catch(async (e) => {
        await saveMeta({ progress });
        throw e;
      });
      const page = parseListPage(html, l.type, l.status);
      if (page.total != null) totals[lk] = page.total;

      let unchanged = 0;
      for (const it of page.items) {
        const old = items[it.key];
        if (old && old.status === it.status && old.markDate === it.markDate) unchanged++;
        items[it.key] = it;
        seen.add(it.key);
      }
      progress.seen[lk] = [...seen];
      progress.pages++;

      await saveItems(items);
      await saveMeta({ progress, totals });

      const caughtUp = mode === 'update' && page.items.length > 0 && unchanged === page.items.length;
      if (!page.hasNext || page.items.length === 0 || caughtUp) {
        listDone = true;
      } else {
        progress.start += PAGE_SIZE;
      }

      if (listDone && mode === 'full') {
        // 全量读完一个清单后，删掉豆瓣上已经不在这个清单里的条目
        for (const [k, it] of Object.entries(items)) {
          if (it.type === l.type && it.status === l.status && !seen.has(k)) delete items[k];
        }
        await saveItems(items);
      }

      const isLastRequest = listDone && progress.listIdx === LISTS.length - 1;
      if (!isLastRequest) {
        const cooldown = progress.pages % COOLDOWN_EVERY === 0;
        const wait = cooldown ? COOLDOWN_MS : DELAY_MIN + Math.random() * (DELAY_MAX - DELAY_MIN);
        if (cooldown) onProgress({ list: l, cooling: true, pages: progress.pages, count: Object.keys(items).length });
        await sleep(wait, shouldStop);
      }
    }
  }

  await saveMeta({ progress: null, totals, lastSync: Date.now(), uid });
  return { stopped: false, count: Object.keys(items).length };
}
