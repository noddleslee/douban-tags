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

// 繁体常用字转简体（只用于比较标签是否重复）
const T2S = { 歷: '历', 學: '学', 說: '说', 書: '书', 藝: '艺', 術: '术', 攝: '摄', 傳: '传', 記: '记', 國: '国', 經: '经',
  濟: '济', 會: '会', 華: '华', 漢: '汉', 臺: '台', 灣: '湾', 東: '东', 圖: '图', 畫: '画', 劇: '剧', 樂: '乐', 戰: '战',
  爭: '争', 實: '实', 紀: '纪', 遊: '游', 愛: '爱', 詩: '诗', 隨: '随', 筆: '笔', 論: '论', 評: '评' };
const simp = (s) => [...norm(s)].map((c) => T2S[c] || c).join('');

// 发给 AI 参考的豆瓣标签：在清洗基础上再去重——简繁写法相同的只留一个；
// 一个标签和排在它前面的标签互相包含（"推理小说""日本推理"都包含"推理"），只留前面那个。最多 limit 个
export function refTags(tags, limit = 10) {
  const kept = [];
  for (const t of tags || []) {
    const n = simp(t);
    if (!n || kept.some((k) => { const m = simp(k); return m === n || (m.length >= 2 && n.includes(m)) || (n.length >= 2 && m.includes(n)); })) continue;
    kept.push(t);
    if (kept.length >= limit) break;
  }
  return kept;
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

// 同一部书的上下册、第一二部：书名去掉卷次后相同、第一作者相同，就算一组
const VOLUME_RE = /[\s:：·,，]*[（(\[【]?\s*(上中下|上下|上|中|下|上册|中册|下册|上卷|下卷|大全集|全集|合集|套装|全[一二三四五六七八九十\d]+[部卷册]|[一二三四五六七八九十]+|\d+|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹ]+|卷[一二三四五六七八九十\d]+|第[一二三四五六七八九十\d]+[部卷册季])\s*[）)\]】]?\s*$/;
// 分册副标题：《大医·破晓篇》《大医·日出篇》（"·"或"："后面是"××篇/卷/部/册"）
const PART_RE = /[·：:][^·：:]{1,6}[篇卷部册]$/;
export function seriesKey(it) {
  let t = norm(it.title).replace(PART_RE, '');
  for (let i = 0; i < 2; i++) t = t.replace(VOLUME_RE, '');
  return t && t.length >= 2 ? `${t}|${norm((it.authors || [])[0])}` : null;
}

// 同组的书合并题材（取并集；有具体二级时去掉"其他"；有 AI 结果的只用 AI 结果）
export function unifySeries(books) {
  const groups = new Map();
  for (const it of books) {
    const k = seriesKey(it);
    if (k) { if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); }
  }
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    // 组里有 AI 归类过的书，就以 AI 的结果为准（规则的误判不再传染给同组的书）
    const ai = g.filter((i) => i.topicSource === 'ai');
    const src = ai.length ? ai : g;
    const topics = [...new Set(src.flatMap((i) => i.topics || []))];
    let subs = [...new Set(src.flatMap((i) => i.subtopics || []))];
    subs = subs.filter((x) => !x.endsWith(`/${OTHER_SUB}`) || !subs.some((y) => y !== x && y.startsWith(x.split('/')[0] + '/')));
    for (const i of g) { i.topics = topics.slice(); i.subtopics = subs.slice(); }
  }
}

// AI 只给了一级、二级是"其他"时，用豆瓣标签按规则补二级（规则也没有就保持"其他"）
export function fillSubs(topics, subs, tags) {
  const out = subs.filter((s) => topics.includes(s.split('/')[0]));
  const rule = tags && tags.length ? classify(tags).subtopics : [];
  for (const t of topics) {
    const mine = out.filter((s) => s.startsWith(`${t}/`));
    if (mine.length && !mine.every((s) => s === `${t}/${OTHER_SUB}`)) continue;
    const add = rule.filter((s) => s.startsWith(`${t}/`) && s !== `${t}/${OTHER_SUB}`);
    if (!add.length) continue;
    for (const s of mine) out.splice(out.indexOf(s), 1);
    out.push(...add);
  }
  return out;
}

// 显示时套用：给书籍加上 topics（一级题材，含"冷门书"）、subtopics（二级）、dtags（清洗后的豆瓣标签）、
// topicSource（'ai' 或 'rule'）。有 AI 结果就用 AI 的，AI 拿不准（空结果）或没开 AI 就用规则
export function applyDetails(items, details, llm = null) {
  const books = [];
  for (const it of Object.values(items)) {
    if (it.type !== 'book') continue;
    books.push(it);
    const d = details[it.key];
    const tags = d ? cleanTags(d.tags, it) : [];
    it.dtags = tags;
    const ai = llm && llm[it.key];
    if (ai && ai.topics && ai.topics.length) {
      it.topics = ai.topics.slice();
      it.subtopics = fillSubs(it.topics, ai.subtopics || [], tags);
      it.topicSource = 'ai';
    } else if (d) {
      const c = classify(tags);
      it.topics = c.topics;
      it.subtopics = c.subtopics;
      it.topicSource = 'rule';
    } else {
      it.topics = []; it.subtopics = []; it.topicSource = null;
    }
    if (d) it.votes = d.votes;
  }
  unifySeries(books);
  for (const it of books) if (isObscure(details[it.key])) it.topics.push(OBSCURE_TAG);
}
