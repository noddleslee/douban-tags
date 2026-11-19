// AI 归类：把书名和作者发给大模型（默认 DeepSeek），按固定的题材清单归类。
// 接口用的是 OpenAI 兼容格式（POST {baseUrl}/chat/completions），换别家模型只要改地址和模型名。
// 结果存在本地（dt_llm），只有新书、书名或作者变了才重新问。
import { TOPIC_RULES, OTHER_SUB } from './topic-rules.js';

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

// 识别这本书用的信息变了才重新问
export const bookSig = (it) => `${it.title || ''}|${(it.authors || []).join('、')}`;

export function systemPrompt(tax = taxonomy()) {
  const lines = Object.entries(tax).map(([t, subs]) => (subs.length ? `- ${t}：${subs.join('、')}` : `- ${t}`));
  return [
    '你是图书分类助手。根据书名和作者判断每本书的题材，只能从下面的清单里选，不能自己创造新词。',
    '清单（"一级：可选的二级"，没有冒号的一级没有二级）：',
    ...lines,
    '规则：',
    '1. 每本书选 1–3 个一级，按贴切程度排列。',
    '2. 一级有二级时，再选 0–2 个二级，写成"一级/二级"，例如"小说/推理悬疑"；二级必须属于你选的一级。',
    '3. 小说就是小说：讲历史、医生、职场的小说归"小说"和对应二级（如"小说/历史小说"），不要再归"历史""科普""经济管理"。',
    '4. 同一部书的上下册、第一二部，题材必须一致。',
    '5. 不认识或拿不准的书，topics 返回空数组，不要猜。',
    '只输出 json，格式：{"results":[{"id":"书的id","topics":["小说"],"subtopics":["小说/推理悬疑"]}]}',
  ].join('\n');
}

export function userPrompt(books) {
  return JSON.stringify(books.map((b) => ({ id: b.id, title: b.title, author: (b.authors || []).join('、') })));
}

// 只保留清单里有的结果；有二级的一级没选二级时记为"其他"
export function validate(raw, tax = taxonomy()) {
  const topics = [...new Set((raw && raw.topics) || [])].filter((t) => t in tax).slice(0, 3);
  const subs = [];
  for (const s of (raw && raw.subtopics) || []) {
    const [t, name] = String(s).split('/');
    if (topics.includes(t) && (tax[t] || []).includes(name) && !subs.includes(`${t}/${name}`)) subs.push(`${t}/${name}`);
  }
  for (const t of topics) if (tax[t].length && !subs.some((s) => s.startsWith(`${t}/`))) subs.push(`${t}/${OTHER_SUB}`);
  return { topics, subtopics: subs };
}

// 问一批书。返回 { id: {topics, subtopics} }
export async function askBatch(books, settings, fetchImpl = fetch) {
  const base = (settings.baseUrl || LLM_DEFAULTS.baseUrl).replace(/\/+$/, '');
  const body = {
    model: settings.model || LLM_DEFAULTS.model,
    messages: [{ role: 'system', content: systemPrompt() }, { role: 'user', content: userPrompt(books) }],
    response_format: { type: 'json_object' },
    thinking: { type: 'disabled' }, // DeepSeek 默认开思考模式，归类用不着，关掉更快更省
    temperature: 0,
    max_tokens: 2000,
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
    let parsed;
    try { parsed = JSON.parse(content); } catch { continue; }
    const out = {};
    for (const r of parsed.results || []) if (r && r.id != null) out[String(r.id)] = validate(r);
    return out;
  }
  throw new LlmError('EMPTY', 'AI 没有返回有效结果，下次再试');
}

// 需要问 AI 的书：没问过，或书名/作者变了
export function booksNeedingLlm(items, cache) {
  return Object.values(items).filter((it) => it.type === 'book' && (!cache[it.key] || cache[it.key].sig !== bookSig(it)));
}

// 分批问完所有需要的书；每批存一次。出错就停，下次打开面板接着问
export async function classifyWithLlm({ items, cache, settings, save, onProgress = () => {}, shouldStop = () => false, fetchImpl }) {
  const todo = booksNeedingLlm(items, cache);
  for (let i = 0; i < todo.length; i += BATCH) {
    if (shouldStop()) break;
    onProgress({ done: i, total: todo.length });
    const batch = todo.slice(i, i + BATCH);
    const got = await askBatch(batch, settings, fetchImpl);
    for (const it of batch) {
      const r = got[it.id] || { topics: [], subtopics: [] }; // 没返回的当作"拿不准"，用规则结果
      cache[it.key] = { ...r, sig: bookSig(it), at: Date.now(), model: settings.model || LLM_DEFAULTS.model };
    }
    await save(cache);
    if (i + BATCH < todo.length) await new Promise((r) => setTimeout(r, PAUSE_MS));
  }
  onProgress({ done: todo.length, total: todo.length });
}
