// AI 归类：把书名、作者和去重后的豆瓣标签发给大模型（默认 DeepSeek），按固定的题材清单归类。
// 接口用的是 OpenAI 兼容格式（POST {baseUrl}/chat/completions），换别家模型只要改地址和模型名。
// 结果存在本地（dt_llm），只有新书、书名、作者、豆瓣标签或提示词版本变了才重新问。
// 同一部书（多个版本、上下册）只问一次，结果套给同组的每一本，保证一致。
import { TOPIC_RULES, OTHER_SUB } from './topic-rules.js';
import { cleanTags, refTags, seriesKey } from './topics.js';

export const PROMPT_VERSION = 3; // 改了提示词就加一，所有书会重新问一遍

export const LLM_DEFAULTS = { baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' };
export const BATCH = 10; // 每次请求问几本书
const PAUSE_MS = 800;

export class LlmError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// 题材清单：{ 一级: [二级…] }
export function taxonomy() {
  const t = {};
  for (const r of TOPIC_RULES) t[r.name] = (r.subs || []).map((s) => s.name);
  return t;
}

// 发给 AI 的参考标签
export const tagsFor = (it, details = {}) => refTags(cleanTags((details[it.key] || {}).tags || [], it));

// 识别这本书用的信息变了才重新问
export const bookSig = (it, details = {}) => `v${PROMPT_VERSION}|${it.title || ''}|${(it.authors || []).join('、')}|${tagsFor(it, details).join(',')}`;

export function systemPrompt(tax = taxonomy()) {
  const lines = Object.entries(tax).map(([t, subs]) => (subs.length ? `- ${t}：${subs.join('、')}` : `- ${t}`));
  return [
    '你是图书分类助手。根据书名、作者和豆瓣读者标签判断每本书的题材，只能从下面的清单里选，不能自己创造新词。',
    '清单（"一级：可选的二级"，没有冒号的一级没有二级）：',
    ...lines,
    '规则：',
    '1. 每本书选 1–3 个一级，按贴切程度排列。',
    '2. 一级有二级时，再选 0–2 个二级，写成"一级/二级"，例如"小说/推理悬疑"；二级必须属于你选的一级。',
    '3. 小说就是小说：讲历史、医生、职场的小说只归"小说"和它的二级，不要再归"历史""科普""经济管理"。',
    '4. 小说的二级定义：',
    '   - 历史小说：以古代或某段历史时期的真实人物、重大历史事件为主线。例：《两京十五日》《巨人的陨落》《静静的顿河》《敦煌》。',
    '   - 近现代小说：以近现代或当代社会为背景，写普通人的生活和命运。例：《活着》《平凡的世界》《许三观卖血记》《人生海海》。',
    '   - 只是故事发生在过去年代，不算历史小说；历史小说和近现代小说一般只选一个。',
    '   - 推理、科幻、奇幻等类型小说先选类型；如果同时有明确的历史背景（如《长安十二时辰》《大唐狄公案》），历史小说也要选。',
    '   - 短篇集：只用于短篇小说合集（如《东京奇谭集》《受戒》），长篇小说不算。',
    '   - 漫画、图像小说、绘本：一定要选"漫画绘本"。',
    '5. tags 是豆瓣读者最常打的标签，按热度排序，可以参考，但可能有错，以你对这本书的了解为准；',
    '   用它来补上明显的次要主题（如女性、政治、哲学），以及判断你不熟悉的书。',
    '6. 不认识、标签也看不出来的书，topics 返回空数组，不要猜。',
    '只输出 json，格式：{"results":[{"id":"书的id","topics":["小说"],"subtopics":["小说/推理悬疑"]}]}',
  ].join('\n');
}

// books: [{ id, title, authors, tags }]
export function userPrompt(books) {
  return JSON.stringify(books.map((b) => ({ id: b.id, title: b.title, author: (b.authors || []).join('、'), tags: b.tags || [] })));
}

// 只保留清单里有的结果；有二级的一级没选二级时记为"其他"
// 小说不再同时归"历史"一级（AI 偶尔不守规则，这里兜底）
export function validate(raw, tax = taxonomy()) {
  let topics = [...new Set((raw && raw.topics) || [])].filter((t) => t in tax);
  if (topics.includes('小说')) topics = topics.filter((t) => t !== '历史');
  topics = topics.slice(0, 3);
  const subs = [];
  for (const s of (raw && raw.subtopics) || []) {
    const [t, name] = String(s).split('/');
    if (topics.includes(t) && (tax[t] || []).includes(name) && !subs.includes(`${t}/${name}`)) subs.push(`${t}/${name}`);
  }
  for (const t of topics) if (tax[t].length && !subs.some((s) => s.startsWith(`${t}/`))) subs.push(`${t}/${OTHER_SUB}`);
  return { topics, subtopics: subs };
}

// 发一次请求，返回模型给出的 JSON 对象（书籍、影视共用）
export async function askJson({ system, user, settings, fetchImpl = fetch }) {
  const base = (settings.baseUrl || LLM_DEFAULTS.baseUrl).replace(/\/+$/, '');
  const body = {
    model: settings.model || LLM_DEFAULTS.model,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    response_format: { type: 'json_object' },
    thinking: { type: 'disabled' }, // DeepSeek 默认开思考模式，归类用不着，关掉更快更省
    temperature: 0,
    max_tokens: 3000,
    stream: false,
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    let res;
    try {
      res = await fetchImpl(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}` },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new LlmError('NETWORK', '连不上 AI 服务，下次打开面板再试');
    }
    if (res.status === 401) throw new LlmError('AUTH', 'API Key 不对，请在"AI 归类"里重新填写');
    if (res.status === 402) throw new LlmError('BALANCE', 'AI 账户余额不足，请到 DeepSeek 平台充值');
    if (res.status === 429) throw new LlmError('RATE', 'AI 服务请求太频繁，稍后再试');
    if (!res.ok) throw new LlmError('HTTP', `AI 服务出错（${res.status}），稍后再试`);
    const data = await res.json();
    const content = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
    if (!content.trim()) continue; // DeepSeek 的 JSON 模式偶尔返回空内容：重试一次
    try { return JSON.parse(content); } catch { continue; }
  }
  throw new LlmError('EMPTY', 'AI 没有返回有效结果，下次再试');
}

// 问一批书。返回 { id: {topics, subtopics} }
export async function askBatch(books, settings, fetchImpl = fetch) {
  const parsed = await askJson({ system: systemPrompt(), user: userPrompt(books), settings, fetchImpl });
  const out = {};
  for (const r of parsed.results || []) if (r && r.id != null) out[String(r.id)] = validate(r);
  return out;
}

// 需要问 AI 的书：没问过，或书名、作者、豆瓣标签、提示词版本变了
export function booksNeedingLlm(items, cache, details = {}) {
  return Object.values(items).filter((it) => it.type === 'book' && (!cache[it.key] || cache[it.key].sig !== bookSig(it, details)));
}

// 把要问的书按"同一部书"分组：组里只要有一本需要问，整组用一个代表去问（标签合并去重）
export function groupsToAsk(items, cache, details = {}) {
  const need = new Set(booksNeedingLlm(items, cache, details).map((i) => i.key));
  const groups = new Map();
  for (const it of Object.values(items)) {
    if (it.type !== 'book') continue;
    const k = seriesKey(it) || it.key;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }
  const out = [];
  for (const members of groups.values()) {
    if (!members.some((m) => need.has(m.key))) continue;
    const rep = members.slice().sort((a, b) => tagsFor(b, details).length - tagsFor(a, details).length)[0];
    const tags = refTags(members.flatMap((m) => tagsFor(m, details)));
    out.push({ id: rep.id, title: rep.title, authors: rep.authors, tags, members });
  }
  return out;
}

// 分批问完所有需要的书；每批存一次。出错就停，下次打开面板接着问。返回这次问了多少本
export async function classifyWithLlm({ items, cache, details = {}, settings, save, onProgress = () => {}, shouldStop = () => false, fetchImpl }) {
  const todo = groupsToAsk(items, cache, details);
  const total = todo.reduce((n, g) => n + g.members.length, 0);
  let done = 0;
  for (let i = 0; i < todo.length; i += BATCH) {
    if (shouldStop()) break;
    onProgress({ done, total });
    const batch = todo.slice(i, i + BATCH);
    const got = await askBatch(batch, settings, fetchImpl);
    for (const g of batch) {
      const r = got[g.id] || { topics: [], subtopics: [] }; // 没返回的当作"拿不准"，用规则结果
      for (const m of g.members) {
        cache[m.key] = { ...r, sig: bookSig(m, details), at: Date.now(), model: settings.model || LLM_DEFAULTS.model, sent: g.tags };
      }
      done += g.members.length;
    }
    await save(cache);
    if (i + BATCH < todo.length) await new Promise((r) => setTimeout(r, PAUSE_MS));
  }
  onProgress({ done: total, total });
  return done;
}
