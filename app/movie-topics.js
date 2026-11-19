// 影视：电影/电视剧区分、题材（AI 优先，规则兜底）、同一部合并、AI 归类。
import { MOVIE_TOPICS, GENRE_RULES, CROSS_CHECK, TV_TITLE_RE, TV_INTRO_RE } from './movie-rules.js';
import { OTHER_SUB } from './topic-rules.js';
import { askJson, LLM_DEFAULTS } from './llm.js';
import { unifySeries } from './topics.js';

export const MOVIE_PROMPT_VERSION = 1;
export const MOVIE_BATCH = 15;
const PAUSE_MS = 800;
const FORMS = ['电影', '电视剧'];
const CONFIDENCE = ['高', '中', '低'];

const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();

export function movieTaxonomy() {
  const t = {};
  for (const r of MOVIE_TOPICS) t[r.name] = r.subs.slice();
  return t;
}

// 规则能确定是电视剧的（片名带"第 X 季"、时长写"单集"）
export function ruleForm(it) {
  if (TV_TITLE_RE.test(`${it.title || ''} ${it.titleFull || ''}`) || TV_INTRO_RE.test(it.raw || '')) return '电视剧';
  return null;
}

// 同一部：片名去掉"第 X 季"等后相同；电影再加上第一导演（同名不同片的情况）
const SEASON_RE = /[\s:：·]*(第[一二三四五六七八九十\d]+季|season\s*\d+|s\d{1,2})\s*$/i;
export function movieSeriesKey(it, tvTitles = null) {
  const t = norm(it.title).replace(SEASON_RE, '');
  if (!t) return null;
  const isSeason = SEASON_RE.test(norm(it.title));
  // 第一季在豆瓣上常常不带"第一季"：同名的其他条目带了季数，就并进同一组
  return isSeason || (tvTitles && tvTitles.has(t)) ? `tv|${t}` : `${t}|${norm((it.directors || [])[0])}`;
}

// 按整个片单生成分组函数（先找出哪些片名有"第 X 季"）
export function movieKeyFn(movies) {
  const tv = new Set();
  for (const it of movies) if (SEASON_RE.test(norm(it.title))) tv.add(norm(it.title).replace(SEASON_RE, ''));
  return (it) => movieSeriesKey(it, tv);
}

// 规则题材：按豆瓣类型粗分
export function genreTopics(genres) {
  const topics = [];
  const subs = [];
  for (const g of genres || []) {
    const v = GENRE_RULES[g];
    if (!v) continue;
    const [t, s] = v.split('/');
    if (!topics.includes(t)) topics.push(t);
    if (s && !subs.includes(v)) subs.push(v);
  }
  const tax = movieTaxonomy();
  for (const t of topics) if (tax[t].length && !subs.some((x) => x.startsWith(`${t}/`))) subs.push(`${t}/${OTHER_SUB}`);
  return { topics, subtopics: subs };
}

export function movieSystemPrompt(tax = movieTaxonomy()) {
  const lines = Object.entries(tax).map(([t, subs]) => (subs.length ? `- ${t}：${subs.join('、')}` : `- ${t}`));
  return [
    '你是影视分类助手。根据片名、导演、年份、国家和豆瓣类型，判断每部影片的题材、是电影还是电视剧，以及你有多大把握。',
    '题材只能从下面的清单里选，不能自己创造新词（"一级：可选的二级"，没有冒号的一级没有二级）：',
    ...lines,
    '规则：',
    '1. 题材是补充豆瓣类型的：写的是这部片讲什么（时代、议题、改编来源），不要重复类型本身。',
    '2. 每部选 0–3 个一级，按贴切程度排列；没有明显题材的普通剧情片、喜剧片可以返回空数组。',
    '3. 一级有二级时，再选 0–2 个二级，写成"一级/二级"，例如"战争与历史/二战"；二级必须属于你选的一级。',
    '4. 真实改编：根据真人真事拍的。改编作品：改编自小说、漫画、游戏、舞台剧的。',
    '5. form：电影或电视剧（剧集、迷你剧、网剧都算电视剧；纪录片按它的形式判断）。',
    '6. confidence：你对这部片的了解程度。高＝很熟悉；中＝大致知道；低＝不认识或只能靠片名猜。',
    '7. 同一部剧的不同季，结果必须一致。',
    '只输出 json，格式：{"results":[{"id":"影片id","form":"电影","topics":["战争与历史"],"subtopics":["战争与历史/二战"],"confidence":"高"}]}',
  ].join('\n');
}

export function movieUserPrompt(movies) {
  return JSON.stringify(movies.map((m) => ({
    id: m.id, title: m.titleFull || m.title, director: (m.directors || []).join('、'),
    year: m.year || '', country: (m.countries || []).join('、'), genres: (m.genres || []).join('、'),
  })));
}

// 只保留清单里有的；有二级的一级没选二级时记"其他"
export function validateMovie(raw, tax = movieTaxonomy()) {
  const topics = [...new Set((raw && raw.topics) || [])].filter((t) => t in tax).slice(0, 3);
  const subs = [];
  for (const s of (raw && raw.subtopics) || []) {
    const [t, name] = String(s).split('/');
    if (topics.includes(t) && tax[t].includes(name) && !subs.includes(`${t}/${name}`)) subs.push(`${t}/${name}`);
  }
  for (const t of topics) if (tax[t].length && !subs.some((s) => s.startsWith(`${t}/`))) subs.push(`${t}/${OTHER_SUB}`);
  const form = FORMS.includes(raw && raw.form) ? raw.form : null;
  const confidence = CONFIDENCE.includes(raw && raw.confidence) ? raw.confidence : '低';
  return { topics, subtopics: subs, form, confidence };
}

export const movieSig = (it) => `m${MOVIE_PROMPT_VERSION}|${it.titleFull || it.title || ''}|${(it.directors || []).join('、')}|${it.year || ''}`;

export function moviesNeedingLlm(items, cache) {
  return Object.values(items).filter((it) => it.type === 'movie' && (!cache[it.key] || cache[it.key].sig !== movieSig(it)));
}

// 同一部（不同季、同片名同导演）只问一次
export function movieGroupsToAsk(items, cache) {
  const need = new Set(moviesNeedingLlm(items, cache).map((i) => i.key));
  const groups = new Map();
  const keyOf = movieKeyFn(Object.values(items).filter((i) => i.type === 'movie'));
  for (const it of Object.values(items)) {
    if (it.type !== 'movie') continue;
    const k = keyOf(it) || it.key;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }
  const out = [];
  for (const members of groups.values()) {
    if (!members.some((m) => need.has(m.key))) continue;
    out.push({ ...members[0], members });
  }
  return out;
}

export async function classifyMoviesWithLlm({ items, cache, settings, save, onProgress = () => {}, shouldStop = () => false, fetchImpl }) {
  const todo = movieGroupsToAsk(items, cache);
  const total = todo.reduce((n, g) => n + g.members.length, 0);
  let done = 0;
  for (let i = 0; i < todo.length; i += MOVIE_BATCH) {
    if (shouldStop()) break;
    onProgress({ done, total });
    const batch = todo.slice(i, i + MOVIE_BATCH);
    const parsed = await askJson({ system: movieSystemPrompt(), user: movieUserPrompt(batch), settings, fetchImpl });
    const got = {};
    for (const r of parsed.results || []) if (r && r.id != null) got[String(r.id)] = validateMovie(r);
    for (const g of batch) {
      const r = got[g.id] || { topics: [], subtopics: [], form: null, confidence: '低' }; // 没返回的当作拿不准
      for (const m of g.members) cache[m.key] = { ...r, sig: movieSig(m), at: Date.now(), model: settings.model || LLM_DEFAULTS.model };
      done += g.members.length;
    }
    await save(cache);
    if (i + MOVIE_BATCH < todo.length) await new Promise((res) => setTimeout(res, PAUSE_MS));
  }
  onProgress({ done: total, total });
  return done;
}

// AI 的题材和豆瓣类型对不上（如说是战争片、类型里却没有战争/历史）→ 待核
export function crossCheck(topics, genres) {
  const out = [];
  for (const t of topics || []) {
    const need = CROSS_CHECK[t];
    if (need && !need.some((g) => (genres || []).includes(g))) out.push(t);
  }
  return out;
}

// 显示时套用：form（电影/电视剧）、topics、subtopics、topicSource、aiConfidence。
// AI 把握为"低"或没给题材时，用豆瓣类型粗分
export function applyMovieTopics(items, llm = null) {
  const movies = [];
  for (const it of Object.values(items)) {
    if (it.type !== 'movie') continue;
    movies.push(it);
    const ai = llm && llm[it.key];
    it.form = ruleForm(it) || (ai && ai.form) || '电影';
    it.aiConfidence = ai ? ai.confidence : null;
    if (ai && ai.topics && ai.topics.length && ai.confidence !== '低') {
      it.topics = ai.topics.slice();
      it.subtopics = (ai.subtopics || []).slice();
      it.topicSource = 'ai';
    } else {
      const g = genreTopics(it.genres);
      it.topics = g.topics;
      it.subtopics = g.subtopics;
      it.topicSource = 'rule';
    }
  }
  unifySeries(movies, movieKeyFn(movies));
}
