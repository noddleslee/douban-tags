// 作者文化归属：用中文维基百科和维基数据判断作者属于中国大陆、中国台湾、中国香港，还是外国。
// 只用于豆瓣上没标国籍、被推断为"中国大陆"的作者。看的是成长和创作的文化环境，不只是护照。

import { AUTHOR_OVERRIDES } from './author-overrides.js';

const WD = 'https://www.wikidata.org/w/api.php?format=json&origin=*';
const WP = 'https://zh.wikipedia.org/w/api.php?format=json&origin=*&variant=zh-cn';

// 维基数据里的地区编号
const REGION_IDS = {
  hk: ['Q8646', 'Q1054923'], // 香港、英属香港
  mo: ['Q14773', 'Q1990977'], // 澳门、葡属澳门
  tw: ['Q865', 'Q22502'], // 台湾（中华民国 1949 年后）、台湾岛
  cn: ['Q148', 'Q13426199', 'Q8733', 'Q29520'], // 中华人民共和国、中华民国（1912–1949）、清朝、中国
};
export const REGION_NAME = { hk: '中国香港', mo: '中国澳门', tw: '中国台湾', cn: '中国大陆' };
const REGION_ORDER = ['hk', 'mo', 'tw', 'cn']; // 同时出现时，越具体的越优先（香港大学也挂着"中华人民共和国"）

const WRITER_RE = /作家|作者|学者|學者|历史|歷史|诗人|詩人|记者|記者|教授|编剧|編劇|导演|導演|评论|評論|散文|小说|小說|作词|作詞|艺术|藝術|汉学|漢學|思想|哲学|哲學|社会学|社會學|经济学|經濟學|政治|研究|出版|画家|畫家|翻译|翻譯/;
const OVERSEAS_CHINESE_RE = /华裔|華裔|华人|華人/;
const CJK_RE = /[\u4e00-\u9fff]/;

export function regionOfIds(ids) {
  const set = new Set(ids || []);
  for (const r of REGION_ORDER) if (REGION_IDS[r].some((q) => set.has(q))) return r;
  return null;
}

// 书名主干：去掉副标题、括号、书名号
export function titleCore(t) {
  const s = String(t || '').replace(/[《》「」『』]/g, '').split(/[:：(（—\-｜|]/)[0].replace(/\s+/g, '').trim();
  return s.length >= 2 ? s : null;
}

/**
 * 判断文化归属（纯函数，方便测试）。
 * person: { desc, citizenship: [qid], citizenshipLabels: [中文名], schools: [{ regions: [qid], start }], birthRegions: [qid] }
 * 返回 { region: '中国台湾' | '美国' | ..., reason } 或 null
 */
export function decideRegion(person) {
  const desc = person.desc || '';

  // 1. 简介里直接写了地区
  if (/臺灣|台灣|台湾/.test(desc)) return { region: REGION_NAME.tw, reason: '简介' };
  if (/香港/.test(desc)) return { region: REGION_NAME.hk, reason: '简介' };
  if (/澳門|澳门/.test(desc)) return { region: REGION_NAME.mo, reason: '简介' };

  // 2. 海外华人学者：看青年时代受教育的地区（大部分学校在哪），再看出生地
  if (OVERSEAS_CHINESE_RE.test(desc)) {
    const count = {};
    const first = {};
    for (const s of person.schools || []) {
      const r = regionOfIds(s.regions);
      if (!r) continue;
      count[r] = (count[r] || 0) + 1;
      if (s.start && (!first[r] || s.start < first[r])) first[r] = s.start;
    }
    const ranked = Object.keys(count).sort((a, b) => count[b] - count[a]
      || String(first[a] || '9').localeCompare(String(first[b] || '9')));
    if (ranked.length) return { region: REGION_NAME[ranked[0]], reason: '就读学校' };
    const br = regionOfIds(person.birthRegions);
    if (br) return { region: REGION_NAME[br], reason: '出生地' };
  }

  // 3. 简介写的是中国
  if (/中国|中國/.test(desc)) return { region: REGION_NAME.cn, reason: '简介' };

  // 4. 国籍字段
  const cr = regionOfIds(person.citizenship);
  if (cr) return { region: REGION_NAME[cr], reason: '国籍' };

  // 5. 外国人：用国籍的中文名
  const foreign = (person.citizenshipLabels || []).find(Boolean);
  if (foreign) return { region: foreign, reason: '国籍' };
  return null;
}

async function getJson(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function entities(ids, props) {
  const out = {};
  for (let i = 0; i < ids.length; i += 40) {
    const chunk = ids.slice(i, i + 40);
    const r = await getJson(`${WD}&action=wbgetentities&ids=${chunk.join('|')}&props=${props}&languages=zh-cn|zh-hans|zh`);
    Object.assign(out, r.entities || {});
  }
  return out;
}

const claimIds = (e, p) => ((e && e.claims && e.claims[p]) || [])
  .map((c) => ({ id: c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value && c.mainsnak.datavalue.value.id,
    start: c.qualifiers && c.qualifiers.P580 && c.qualifiers.P580[0].datavalue && c.qualifiers.P580[0].datavalue.value.time }))
  .filter((x) => x.id);
const isHuman = (e) => claimIds(e, 'P31').some((c) => c.id === 'Q5');
const zhLabel = (e) => e && e.labels && ((e.labels['zh-cn'] || e.labels.zh || {}).value);
const zhDesc = (e) => (e && e.descriptions && ((e.descriptions['zh-cn'] || e.descriptions.zh || {}).value)) || '';

// 去掉名字里夹的注音，如"许倬（zhuō）云"
function stripReading(s) {
  return String(s || '').replace(/[（(][^）)\u4e00-\u9fff]{1,15}[)）]/g, '');
}

// 在中文维基百科里搜"作者名 + 书名"，找出候选人物（以及书页面上记录的作者）
async function wikiCandidates(name, query) {
  const s = await getJson(`${WP}&action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=6&srprop=`);
  const titles = ((s.query && s.query.search) || []).map((x) => x.title);
  if (!titles.length) return [];
  const p = await getJson(`${WP}&action=query&prop=pageprops|extracts&exintro=1&explaintext=1&ppprop=wikibase_item&converttitles=1&titles=${encodeURIComponent(titles.join('|'))}`);
  return Object.values((p.query && p.query.pages) || [])
    .filter((x) => x.pageprops && x.pageprops.wikibase_item)
    .map((x) => ({ qid: x.pageprops.wikibase_item, title: x.title, intro: x.extract || '' }));
}

async function pageMentions(title, cores) {
  if (!title || !cores.length) return false;
  const r = await getJson(`${WP}&action=query&prop=extracts&explaintext=1&redirects=1&titles=${encodeURIComponent(title)}`);
  const text = (Object.values((r.query && r.query.pages) || [])[0] || {}).extract || '';
  return cores.some((c) => text.replace(/\s+/g, '').includes(c));
}

/**
 * 查一位作者。bookTitles：你标记过的这位作者的书名，用来区分同名的人。
 * 返回 { region, qid, reason } ；查不到或判断不了时 region 为 null。
 */
export async function lookupAuthor(name, bookTitles = []) {
  if (AUTHOR_OVERRIDES[name]) return { region: AUTHOR_OVERRIDES[name], qid: null, reason: '手动修正' };
  const cores = [...new Set(bookTitles.map(titleCore).filter(Boolean))].slice(0, 3);

  // 1. 搜索候选：多搜几种组合，把候选都收集起来再判断（只搜一次容易碰上古代同名的人）
  //    开头提到这个名字的页面先都收进来：是人物的直接当候选；是书的，读出它记录的作者
  const pages = new Map();
  const bookPageIds = new Set(); // 你标记的那本书自己的维基页面
  const queries = [...cores.slice(0, 2).map((c) => `${name} ${c}`), `${name} 作家`, name];
  // 几次搜索同时发出，结果仍按顺序处理（判断结果和逐个搜索时一样）
  const results = await Promise.all(queries.map((q) => wikiCandidates(name, q).catch(() => [])));
  for (const list of results) {
    for (const c of list) {
      const intro = stripReading(c.intro).slice(0, 80);
      const isBookPage = cores.some((core) => c.title.replace(/\s+/g, '').includes(core) || intro.slice(0, 40).includes(core));
      if (intro.includes(name) || isBookPage) pages.set(c.qid, c);
      if (isBookPage) bookPageIds.add(c.qid);
    }
  }

  let ids = [...pages.keys()];
  // 中文维基没有页面的人，维基数据里可能有（如鲍大可）
  if (!ids.length) {
    const r = await getJson(`${WD}&action=wbsearchentities&search=${encodeURIComponent(name)}&language=zh&uselang=zh-cn&type=item&limit=8`);
    ids = ((r && r.search) || []).map((x) => x.id);
  }
  if (!ids.length) return { region: null, qid: null, reason: '维基百科没有找到' };

  const ents = await entities(ids, 'claims|descriptions|labels|sitelinks');
  // 书页面上记录的作者（只看你标记的那本书的页面）
  const authorIds = [...new Set([...bookPageIds].map((id) => ents[id]).filter((e) => e && !isHuman(e)).flatMap((e) => claimIds(e, 'P50').map((c) => c.id)))];
  const missing = authorIds.filter((id) => !ents[id]);
  if (missing.length) Object.assign(ents, await entities(missing, 'claims|descriptions|labels|sitelinks'));
  let humans = [...new Set([...authorIds, ...ids])].map((id) => ents[id]).filter((e) => e && isHuman(e));
  if (!humans.length) return { region: null, qid: null, reason: '没有对应的人物' };

  // 2. 优先选条目名字就是这个作者名的人（排除页面里顺带提到他的人，如他的父亲）
  // 条目名可能是繁体（楊照），所以也看已转成简体的简介：开头就是这个名字，或写着"笔名杨照"
  const introOf = (e) => stripReading((pages.get(e.id) || {}).intro || '');
  const named = humans.filter((e) => ['zh-cn', 'zh-hans', 'zh'].some((l) => e.labels && e.labels[l] && stripReading(e.labels[l].value) === name)
    || (introOf(e).startsWith(name) && !CJK_RE.test(introOf(e).charAt(name.length))) || new RegExp(`(笔名|本名|原名|又名)[^，。]{0,4}${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(introOf(e).slice(0, 80)));
  // 只认两种人：名字确实一致的（含笔名）；你标记的书的页面上记录的作者。都没有就不判断，宁可不改也不改错
  humans = humans.filter((e) => named.includes(e) || authorIds.includes(e.id));
  if (!humans.length) return { region: null, qid: null, reason: '没有名字完全一致的人' };
  // 维基数据没有中文简介时，用维基百科正文第一句代替（如"……笔名杨照，是一名台湾时事评论员、作家"）
  const descOf = (e) => zhDesc(e) || introOf(e).split('。')[0].slice(0, 100);

  // 3. 多个候选：书页面直接指向的作者 > 维基页面里提到你标记的书 > 简介像作者
  let person = humans.find((e) => authorIds.includes(e.id));
  if (!person && humans.length > 1) {
    for (const e of humans.slice(0, 4)) {
      const t = e.sitelinks && e.sitelinks.zhwiki && e.sitelinks.zhwiki.title;
      if (await pageMentions(t, cores)) { person = e; break; }
    }
  }
  if (!person) person = humans.find((e) => WRITER_RE.test(descOf(e)));
  if (!person && humans.length === 1 && cores.length) {
    const t = humans[0].sitelinks && humans[0].sitelinks.zhwiki && humans[0].sitelinks.zhwiki.title;
    if (await pageMentions(t, cores)) person = humans[0];
  }
  if (!person) return { region: null, qid: null, reason: '无法确认是哪位同名的人' };

  // 4. 取学校、出生地、国籍的地区信息
  const schools = claimIds(person, 'P69');
  const births = claimIds(person, 'P19');
  const cits = claimIds(person, 'P27');
  const refIds = [...new Set([...schools, ...births, ...cits].map((x) => x.id))];
  const refs = refIds.length ? await entities(refIds, 'claims|labels') : {};
  const p17 = (id) => [id, ...claimIds(refs[id], 'P17').map((c) => c.id)];

  const decided = decideRegion({
    desc: descOf(person),
    citizenship: cits.map((c) => c.id),
    citizenshipLabels: cits.map((c) => zhLabel(refs[c.id])),
    schools: schools.map((s) => ({ regions: p17(s.id), start: s.start })),
    birthRegions: births.flatMap((b) => p17(b.id)),
  });
  return decided ? { ...decided, qid: person.id } : { region: null, qid: person.id, reason: '信息不足' };
}

// 书籍条目的国家：推断出来的"中国大陆"用查到的文化归属替换
export function applyAuthorRegions(items, cache) {
  let changed = 0;
  for (const it of Object.values(items)) {
    if (it.type !== 'book' || !it.countryGuess || !it.authors || !it.authors.length) continue;
    const name = it.authors[0];
    const region = AUTHOR_OVERRIDES[name] || (cache[name] && cache[name].region);
    const next = [region || '中国大陆'];
    if (next.join() !== (it.countries || []).join()) { it.countries = next; changed++; }
  }
  return changed;
}

// 哪些作者需要查：推断为中国的作者里，还没查过的，或者上次没查到且超过 30 天的
export function authorsToLookup(items, cache, now = Date.now()) {
  const books = {};
  for (const it of Object.values(items)) {
    if (it.type !== 'book' || !it.countryGuess || !it.authors || !it.authors.length) continue;
    const name = it.authors[0];
    (books[name] = books[name] || []).push(it.titleFull || it.title);
  }
  return Object.entries(books)
    .filter(([name]) => !AUTHOR_OVERRIDES[name])
    .filter(([name]) => !cache[name] || (!cache[name].region && now - (cache[name].at || 0) > 30 * 86400000))
    .map(([name, titles]) => ({ name, titles }));
}
