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
  await chrome.storage.local.remove([ITEMS, META]);
}
