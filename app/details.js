// 书籍详情页：读取豆瓣成员常用标签和评价人数。
// 常用标签不直接显示在页面上，藏在页面脚本的 criteria 变量里，形如 '7:推理|7:日本|3:/subject/xxx/'，7: 开头的是标签。

export function parseDetailPage(html) {
  const s = String(html || '');
  const m = s.match(/criteria\s*=\s*'([^']*)'/);
  const tags = m
    ? [...new Set(m[1].split('|').filter((x) => x.startsWith('7:')).map((x) => x.slice(2).replace(/&amp;/g, '&').trim()).filter(Boolean))]
    : [];
  const v = s.match(/property="v:votes"[^>]*>\s*(\d+)\s*</);
  return { tags, votes: v ? Number(v[1]) : 0 };
}

const DELAY_MIN = 2000;
const DELAY_MAX = 5000;
const COOLDOWN_EVERY = 10;
const COOLDOWN_MS = 30000;

const sleep = async (ms, shouldStop) => {
  const end = Date.now() + ms;
  while (Date.now() < end && !shouldStop()) await new Promise((r) => setTimeout(r, Math.min(500, end - Date.now())));
};

// 需要读取详情页的书：还没读过的
export function booksNeedingDetails(items, details) {
  return Object.values(items).filter((it) => it.type === 'book' && !details[it.key]);
}

/**
 * 逐本读取详情页，结果写进 details（{ key: { tags, votes, at } }），每读几本保存一次。
 * 遇到限流或网络问题就停下，下次打开面板接着读。
 */
export async function fetchDetails({ items, details, save, onProgress = () => {}, shouldStop = () => false }) {
  const todo = booksNeedingDetails(items, details);
  for (let i = 0; i < todo.length; i++) {
    if (shouldStop()) break;
    const it = todo[i];
    onProgress({ done: i, total: todo.length });
    const res = await fetch(`https://book.douban.com/subject/${it.id}/`, { credentials: 'include' });
    if (/sec\.douban\.com|accounts\.douban\.com/.test(res.url) || [403, 418, 429].includes(res.status)) {
      await save(details);
      throw new Error('豆瓣暂时限制了访问，书籍详情稍后再读');
    }
    if (res.status === 404) {
      details[it.key] = { tags: [], votes: 0, at: Date.now(), missing: true }; // 条目已下架
    } else if (res.ok) {
      details[it.key] = { ...parseDetailPage(await res.text()), at: Date.now() };
    }
    if (i % 5 === 4 || i === todo.length - 1) await save(details);
    if (i < todo.length - 1) {
      await sleep((i + 1) % COOLDOWN_EVERY === 0 ? COOLDOWN_MS : DELAY_MIN + Math.random() * (DELAY_MAX - DELAY_MIN), shouldStop);
    }
  }
  await save(details);
  onProgress({ done: todo.length, total: todo.length });
}
