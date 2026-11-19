// 数据只存在浏览器本地（chrome.storage.local），不上传任何地方。
const ITEMS = 'dt_items';
const META = 'dt_meta';

export async function loadItems() {
  const r = await chrome.storage.local.get(ITEMS);
  return r[ITEMS] || {};
}

export async function saveItems(map) {
  await chrome.storage.local.set({ [ITEMS]: map });
}

export async function loadMeta() {
  const r = await chrome.storage.local.get(META);
  return r[META] || {};
}

export async function saveMeta(patch) {
  const meta = { ...(await loadMeta()), ...patch };
  await chrome.storage.local.set({ [META]: meta });
  return meta;
}

export async function clearAll() {
  await chrome.storage.local.remove([ITEMS, META, 'dt_authors', 'dt_details', 'dt_llm']); // AI 设置（API Key）保留
}

// 作者文化归属的查询结果：{ 作者名: { region, qid, reason, at } }
const AUTHORS = 'dt_authors';

export async function loadAuthors() {
  const r = await chrome.storage.local.get(AUTHORS);
  return r[AUTHORS] || {};
}

export async function saveAuthors(map) {
  await chrome.storage.local.set({ [AUTHORS]: map });
}

// 书籍详情页数据：{ 'book:ID': { tags, votes, at } }。单独存放，避免和读取书单同时写同一份数据
const DETAILS = 'dt_details';

export async function loadDetails() {
  const r = await chrome.storage.local.get(DETAILS);
  return r[DETAILS] || {};
}

export async function saveDetails(map) {
  await chrome.storage.local.set({ [DETAILS]: map });
}

// AI 归类结果：{ 'book:ID': { topics, subtopics, sig, at, model } }
const LLM = 'dt_llm';

export async function loadLlm() {
  const r = await chrome.storage.local.get(LLM);
  return r[LLM] || {};
}

export async function saveLlm(map) {
  await chrome.storage.local.set({ [LLM]: map });
}

// AI 设置：{ apiKey, baseUrl, model, enabled }。API Key 只存在这个浏览器里
const SETTINGS = 'dt_settings';

export async function loadSettings() {
  const r = await chrome.storage.local.get(SETTINGS);
  return r[SETTINGS] || {};
}

export async function saveSettings(patch) {
  const s = { ...(await loadSettings()), ...patch };
  await chrome.storage.local.set({ [SETTINGS]: s });
  return s;
}
