// 侧边栏面板：读取记录、显示进度。
import { loadItems, saveItems, loadMeta, saveMeta, clearAll } from './store.js';
import { reparseItem } from './listpage.js';
import { PARSER_VERSION } from './parser.js';
import { runSync, detectUid, parseUidInput, LISTS } from './sync.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LIST_NAME = {
  'movie:wish': '想看的电影', 'book:wish': '想读的书', 'movie:collect': '看过的电影',
  'book:collect': '读过的书', 'movie:do': '在看的电影', 'book:do': '在读的书',
};

let ui;
let syncing = false;
let stopRequested = false;
let lastError = null;
let detectedUid = null;

function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function refreshList() {
  const items = Object.values(await loadItems());
  if (!ui) ui = window.DoubanTagsUI.mount($('root'), items, { persist: true, emptyHtml: '' });
  else ui.update(items);
  return items;
}

async function renderStatus(progressInfo) {
  const meta = await loadMeta();
  const items = await loadItems();
  const count = Object.keys(items).length;
  const uid = meta.uid || detectedUid;
  const err = lastError ? `<p class="dt-err">${esc(lastError)}</p>` : '';

  if (syncing) {
    const info = progressInfo || {};
    const lk = info.list ? `${info.list.type}:${info.list.status}` : '';
    const listIdx = LISTS.findIndex((l) => `${l.type}:${l.status}` === lk);
    const pct = listIdx >= 0 ? Math.round(((listIdx + (info.total ? Math.min(1, info.start / info.total) : 0)) / LISTS.length) * 100) : 0;
    const where = info.cooling
      ? '每读 10 页休息 30 秒，避免被豆瓣限流…'
      : `正在读取：${LIST_NAME[lk] || ''}${info.total ? `（${Math.min(info.start + 15, info.total)} / ${info.total}）` : ''}`;
    $('status').innerHTML = `<div class="dt-card">
      <p><strong>${esc(where)}</strong></p>
      <div class="dt-bar"><i style="width:${pct}%"></i></div>
      <p>已读取 ${info.count || count} 条。第一次大约需要 5–10 分钟，请保持这个面板开着；中途关掉也没关系，下次点"继续"会接着读。</p>
      <div class="dt-actions"><button class="dt-secondary" id="stop">暂停</button></div></div>`;
    $('stop').onclick = () => { stopRequested = true; $('stop').textContent = '正在暂停…'; };
    return;
  }

  if (meta.progress) {
    $('status').innerHTML = `<div class="dt-card">${err}
      <p>上次读取还没完成（已读取 ${count} 条）。</p>
      <div class="dt-actions"><button class="dt-primary" id="resume">继续读取</button></div></div>`;
    $('resume').onclick = () => startSync(meta.progress.uid, meta.progress.mode);
    return;
  }

  if (!count) {
    $('status').innerHTML = `<div class="dt-card">${err}
      <p><strong>第一步：读取你的豆瓣书影记录</strong></p>
      <p>插件会逐页读取你的想读、想看、读过、看过清单，自动整理出类型、国家、年代、演员、作者等标签。数据只保存在这个浏览器里。</p>
      <p>${uid ? `已识别到你的豆瓣账号：<strong>${esc(uid)}</strong>` : '没有识别到登录的豆瓣账号。请先登录豆瓣，或者粘贴你的豆瓣主页链接：'}</p>
      ${uid ? '' : '<input class="dt-uid" id="uid" placeholder="https://www.douban.com/people/你的ID/">'}
      <div class="dt-actions"><button class="dt-primary" id="start">开始读取</button></div></div>`;
    $('start').onclick = () => {
      const u = uid || parseUidInput($('uid') && $('uid').value);
      if (!u) { lastError = '请粘贴正确的豆瓣主页链接，形如 https://www.douban.com/people/12345678/'; renderStatus(); return; }
      startSync(u, 'full');
    };
    return;
  }

  $('status').innerHTML = err ? `<div class="dt-card">${err}</div>` : '';
}

async function renderFoot() {
  const meta = await loadMeta();
  const count = Object.keys(await loadItems()).length;
  if (!count) { $('foot').innerHTML = ''; return; }
  $('foot').innerHTML = `<span>共 ${count} 条 · 更新于 ${esc(fmtTime(meta.lastSync) || '—')}</span>
    <span class="dt-actions">
      <button class="dt-link-btn" id="update" title="只读取最新标记的内容">更新</button>
      <button class="dt-link-btn" id="full" title="重新读取全部清单">全部重读</button>
      <button class="dt-link-btn" id="reset" title="清空本地数据">清空</button>
    </span>`;
  const uid = meta.uid;
  $('update').onclick = () => uid && startSync(uid, 'update');
  $('full').onclick = () => uid && startSync(uid, 'full');
  $('reset').onclick = async () => {
    if ($('reset').dataset.confirm) {
      await clearAll(); lastError = null; await refreshList(); await renderStatus(); await renderFoot();
    } else {
      $('reset').dataset.confirm = '1'; $('reset').textContent = '再点一次确认清空';
    }
  };
}

async function startSync(uid, mode) {
  if (syncing) return;
  syncing = true; stopRequested = false; lastError = null;
  await saveMeta({ uid });
  await renderStatus({});
  $('foot').innerHTML = '';
  let pagesSinceRefresh = 0;
  try {
    await runSync({
      uid,
      mode,
      shouldStop: () => stopRequested,
      onProgress: (info) => {
        renderStatus(info);
        if (++pagesSinceRefresh >= 3) { pagesSinceRefresh = 0; refreshList(); }
      },
    });
  } catch (e) {
    lastError = e.message || String(e);
    console.error('[douban-tags]', e);
  } finally {
    syncing = false;
    await saveMeta({ parserVersion: PARSER_VERSION });
    await refreshList();
    await renderStatus();
    await renderFoot();
  }
}

$('close').onclick = () => window.close();

// 解析规则更新后，用已存的原始简介重新拆一遍
async function reparseIfNeeded() {
  const meta = await loadMeta();
  if (meta.parserVersion === PARSER_VERSION) return;
  const items = await loadItems();
  for (const k of Object.keys(items)) items[k] = reparseItem(items[k]);
  await saveItems(items);
  await saveMeta({ parserVersion: PARSER_VERSION });
}

(async function init() {
  await reparseIfNeeded();
  const meta = await loadMeta();
  if (!meta.uid) detectedUid = await detectUid();
  await refreshList();
  await renderStatus();
  await renderFoot();
})();
