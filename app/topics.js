// 书籍题材：把豆瓣成员常用标签归并成统一的题材，并标出冷门书。
// 题材词表在 topic-rules.js，可以自己增删；改完不需要重新读取豆瓣，刷新面板即生效。
import { TOPIC_RULES, NOISE_TAGS, NOISE_RE, OBSCURE, IF_FICTION, OTHER_SUB } from './topic-rules.js';
import { COUNTRIES } from './parser.js';

export const OBSCURE_TAG = '冷门书';

// 全角转半角、去空白，用于比较
const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();

// 简繁写法不同的同一个名字（东野圭吾 / 東野圭吾）：长度相同，只差少数几个字
function nearlySame(a, b) {
  if (a.length !== b.length || a.length < 3) return a === b;
  let diff = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
  return diff <= Math.floor(a.length / 3);
}

// 豆瓣标签清洗：去掉作者名、书名、国家（已有单独分组）、空泛词，去重（含简繁写法相同的）
export function cleanTags(tags, item = {}) {
  const people = [...(item.authors || []), ...(item.translators || [])].filter(Boolean).map(norm);
  const drop = new Set([
    ...(item.authors || []), ...(item.translators || []), item.title, item.titleFull,
    ...NOISE_TAGS,
  ].filter(Boolean).map(norm));
  const titleCore = norm(String(item.title || '').split(/[:：(（]/)[0]);
  const out = [];
  const seen = new Set();
  for (const t of tags || []) {
    const n = norm(t);
    if (!n || drop.has(n) || COUNTRIES.has(t) || seen.has(n)) continue;
    if (people.some((p) => nearlySame(n, p))) continue;
    if (titleCore && titleCore.length >= 2 && (n === titleCore || n.includes(titleCore))) continue;
    if (/^\d{2,4}$/.test(n)) continue; // 年份
    if (NOISE_RE.test(t)) continue; // 出版社名
    seen.add(n);
    out.push(t);
  }
  return out;
}

// 一条规则是否命中（keys 包含即算；exact 完全一致，可限前 top 个；skip 里的词所在标签不看；unless 出现就不算）
function ruleHits(rule, ns) {
  const skip = (rule.skip || []).map(norm);
  const pool = skip.length ? ns.filter((t) => !skip.some((k) => t.includes(k))) : ns;
  // 豆瓣常用标签按打的人数从多到少排列；top：泛词只在排名靠前的标签里出现才算
  const exactPool = rule.top ? ns.slice(0, rule.top).filter((t) => pool.includes(t)) : pool;
  const hit = (rule.keys || []).some((k) => { const nk = norm(k); return pool.some((t) => t.includes(nk)); })
    || (rule.exact || []).some((k) => exactPool.includes(norm(k)));
  const blocked = rule.unless && rule.unless.some((k) => ns.some((t) => t.includes(norm(k))));
  return hit && !blocked;
}

// 根据标签归并出一级题材和二级题材（一本书可以有多个）。
// 二级写成"一级/二级"，例如"小说/推理悬疑"；有二级的一级里没命中任何二级的，记为"一级/其他"
export function classify(tags) {
  const ns = (tags || []).map(norm);
  const topics = TOPIC_RULES.filter((r) => ruleHits(r, ns)).map((r) => r.name);
  const extraSubs = [];
  if (topics.includes('小说')) {
    for (const [from, to] of Object.entries(IF_FICTION)) {
      const i = topics.indexOf(from);
      if (i >= 0) { topics.splice(i, 1); extraSubs.push(`小说/${to}`); }
    }
  }
  const subtopics = [];
  for (const rule of TOPIC_RULES) {
    if (!rule.subs || !topics.includes(rule.name)) continue;
    const mine = rule.subs.filter((s) => ruleHits({ ...s, skip: [...(rule.skip || []), ...(s.skip || [])] }, ns))
      .map((s) => `${rule.name}/${s.name}`);
    for (const x of extraSubs) if (x.startsWith(`${rule.name}/`) && !mine.includes(x)) mine.push(x);
    subtopics.push(...(mine.length ? mine : [`${rule.name}/${OTHER_SUB}`]));
  }
  return { topics, subtopics };
}

// 只要一级题材
export const topicsOf = (tags) => classify(tags).topics;

// 哪些一级题材有二级（界面用）
export const TOPICS_WITH_SUBS = TOPIC_RULES.filter((r) => r.subs).map((r) => r.name);

export function isObscure(detail) {
  if (!detail || detail.missing) return false;
  return (detail.votes || 0) < OBSCURE.minVotes || (detail.tags || []).length < OBSCURE.minTags;
}

// 显示时套用：给书籍加上 topics（一级题材，含"冷门书"）、subtopics（二级）和 dtags（清洗后的豆瓣标签）
export function applyDetails(items, details) {
  for (const it of Object.values(items)) {
    if (it.type !== 'book') continue;
    const d = details[it.key];
    if (!d) { it.topics = []; it.subtopics = []; it.dtags = []; continue; }
    const tags = cleanTags(d.tags, it);
    it.dtags = tags;
    const c = classify(tags);
    it.topics = c.topics;
    it.subtopics = c.subtopics;
    if (isObscure(d)) it.topics.push(OBSCURE_TAG);
    it.votes = d.votes;
  }
}
