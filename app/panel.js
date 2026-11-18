// 侧边栏面板：第一次读取、后台自动同步、作者文化归属查询。
import { loadItems, saveItems, loadMeta, saveMeta, clearAll, loadAuthors, saveAuthors } from './store.js';
import { reparseItem } from './listpage.js';
import { PARSER_VERSION } from './parser.js';
import { runSync, detectUid, parseUidInput, LISTS } from './sync.js';
import { lookupAuthor, applyAuthorRegions, authorsToLookup } from './authors.js';

const FULL_EVERY_MS = 14 * 86400000; // 每两周后台完整重读一次（发现旧记录的评分、标签改动）
const UPDATE_EVERY_MS = 30 * 60000; // 两次自动"更新"至少间隔 30 分钟

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LIST_NAME = {
  'movie:wish': '想看的电影', 'book:wish': '想读的书', 'movie:collect': '看过的电影',
  'book:collect': '读过的书', 'movie:do': '在看的电影', 'book:do': '在读的书',
};

let ui;
let busy = false; // 正在读取豆瓣或查询作者
let foreground = false; // 第一次读取：用大卡片显示进度
let stopRequested = false;
let lastError = null;
let bgText = ''; // 读取豆瓣的进度
let authorText = ''; // 查询作者归属的进度
let detectedUid = null;

function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function progressText(info) {
  if (info.cooling) return '休息 30 秒，避免被豆瓣限流…';
  const lk = info.list ? `${info.list.type}:${info.list.status}` : '';
  const pos = info.total ? `（${Math.min(info.start + 15, info.total)} / ${info.total}）` : '';
  return `正在读取${LIST_NAME[lk] || ''}${pos}`;
}

// 刷新列表。作者文化归属只在显示时套用、不写回存储，避免和后台读取豆瓣同时写数据、互相覆盖
async function refreshList() {
  const items = await loadItems();
  const authors = await loadAuthors();
  applyAuthorRegions(items, authors);
  const list = Object.values(items);
  if (!ui) ui = window.DoubanTagsUI.mount($('root'), list, { persist: true, emptyHtml: '' });
  else ui.update(list);
  return list;
}

async function renderStatus(info) {
  const meta = await loadMeta();
  const count = Object.keys(await loadItems()).length;
  const uid = meta.uid || detectedUid;
  const err = lastError ? `<p class="dt-err">${esc(lastError)}</p>` : '';

  if (busy && foreground) {
    const i = info || {};
    const lk = i.list ? `${i.list.type}:${i.list.status}` : '';
    const idx = LISTS.findIndex((l) => `${l.type}:${l.status}` === lk);
    const pct = idx >= 0 ? Math.round(((idx + (i.total ? Math.min(1, i.start / i.total) : 0)) / LISTS.length) * 100) : 0;
    $('status').innerHTML = `<div class="dt-card">
      <p><strong>${esc(progressText(i))}</strong></p>
      <div class="dt-bar"><i style="width:${pct}%"></i></div>
      <p>已读取 ${i.count || count} 条。第一次大约需要 5–10 分钟，请保持这个面板开着；中途关掉也没关系，下次打开会接着读。</p>
      <div class="dt-actions"><button class="dt-secondary" id="stop">暂停</button></div></div>`;
    $('stop').onclick = () => { stopRequested = true; $('stop').textContent = '正在暂停…'; };
    return;
  }

  if (!count && !meta.progress) {
    $('status').innerHTML = `<div class="dt-card">${err}
      <p><strong>第一步：读取你的豆瓣书影记录</strong></p>
      <p>插件会逐页读取你的想读、想看、读过、看过清单，自动整理出类型、国家、年代、演员、作者等标签。数据只保存在这个浏览器里。以后每次打开面板，都会在后台自动同步。</p>
      <p>${uid ? `已识别到你的豆瓣账号：<strong>${esc(uid)}</strong>` : '没有识别到登录的豆瓣账号。请先登录豆瓣，或者粘贴你的豆瓣主页链接：'}</p>
      ${uid ? '' : '<input class="dt-uid" id="uid" placeholder="https://www.douban.com/people/你的ID/">'}
      <div class="dt-actions"><button class="dt-primary" id="start">开始读取</button></div></div>`;
    $('start').onclick = () => {
      const u = uid || parseUidInput($('uid') && $('uid').value);
      if (!u) { lastError = '请粘贴正确的豆瓣主页链接，形如 https://www.douban.com/people/12345678/'; renderStatus(); return; }
      firstSync(u);
    };
    return;
  }

  if (!count && meta.progress) {
    $('status').innerHTML = `<div class="dt-card">${err}<p>上次读取还没完成。</p>
      <div class="dt-actions"><button class="dt-primary" id="resume">继续读取</button></div></div>`;
    $('resume').onclick = () => firstSync(meta.progress.uid);
    return;
  }

  $('status').innerHTML = '';
}

async function renderFoot() {
  const meta = await loadMeta();
  const count = Object.keys(await loadItems()).length;
  if (!count) { $('foot').innerHTML = ''; return; }
  const lines = [bgText, authorText].filter(Boolean).map(esc).join('<br>');
  const state = busy
    ? `${lines || '后台同步中…'} <button class="dt-link-btn" id="stop-bg">暂停</button>`
    : lastError
      ? `<span class="dt-err">后台同步暂停：${esc(lastError)}</span>`
      : `共 ${count} 条 · 已同步 ${esc(fmtTime(meta.lastSync) || '—')}`;
  $('foot').innerHTML = `<span>${state}</span>
    <span class="dt-actions">
      <button class="dt-link-btn" id="update" title="立即读取最新标记的内容"${busy ? ' disabled' : ''}>更新</button>
      <button class="dt-link-btn" id="full" title="重新读取全部清单，同步删除和修改"${busy ? ' disabled' : ''}>全部重读</button>
      <button class="dt-link-btn" id="reset" title="清空本地数据"${busy ? ' disabled' : ''}>清空</button>
    </span>`;
  if ($('stop-bg')) $('stop-bg').onclick = () => { stopRequested = true; bgText = '正在暂停…'; renderFoot(); };
  $('update').onclick = () => meta.uid && background([{ mode: 'update' }], meta.uid);
  $('full').onclick = () => meta.uid && background([{ mode: 'full' }], meta.uid);
  $('reset').onclick = async () => {
    if ($('reset').dataset.confirm) {
      await clearAll(); lastError = null; await refreshList(); await renderStatus(); await renderFoot();
    } else {
      $('reset').dataset.confirm = '1'; $('reset').textContent = '再点一次确认清空';
    }
  };
}

async function sync(uid, mode, lists, onInfo) {
  let n = 0;
  return runSync({
    uid, mode, lists,
    shouldStop: () => stopRequested,
    onProgress: (info) => { onInfo(info); if (++n % 3 === 0) refreshList(); },
  });
}

// 查询作者文化归属（每位作者只查一次，结果存在本地）
async function lookupAuthors() {
  const items = await loadItems();
  const cache = await loadAuthors();
  const todo = authorsToLookup(items, cache);
  for (let i = 0; i < todo.length; i++) {
    if (stopRequested) break;
    authorText = `正在查询作者的文化归属（${i + 1} / ${todo.length}）`;
    renderFoot();
    const { name, titles } = todo[i];
    try {
      cache[name] = { ...(await lookupAuthor(name, titles)), at: Date.now() };
    } catch (e) {
      console.warn('[douban-tags] 查询作者失败，下次再试', name, e);
      break; // 网络问题：下次打开面板再继续
    }
    if (i % 3 === 2 || i === todo.length - 1) { await saveAuthors(cache); await refreshList(); }
    await new Promise((r) => setTimeout(r, 300));
  }
  await saveAuthors(cache);
  authorText = '';
}

// 后台任务：读取豆瓣（依次执行 steps）和查询作者归属同时进行，互不等待。只在底部显示进度。
async function background(steps, uid) {
  if (busy) return;
  busy = true; foreground = false; stopRequested = false; lastError = null;
  // 作者查询访问的是维基百科，和读取豆瓣互不影响，所以一开始就并行做
  const authorsTask = lookupAuthors().catch((e) => console.warn('[douban-tags] 查询作者出错', e));
  try {
    for (const step of steps) {
      if (stopRequested) break;
      const r = await sync(uid, step.mode, step.lists, (info) => { bgText = progressText(info); renderFoot(); });
      if (r && r.stopped) break;
      // 更新时发现总数对不上，说明豆瓣上删除过条目：只重读那几个清单
      if (step.mode === 'update' && r && r.needFull && r.needFull.length) {
        steps.push({ mode: 'full', lists: r.needFull });
      }
    }
    bgText = '';
    await authorsTask;
    // 这次同步新读到的书，作者还没查过的，补查一次
    if (!stopRequested) await lookupAuthors();
  } catch (e) {
    lastError = e.message || String(e);
    console.error('[douban-tags]', e);
    bgText = '';
    renderFoot();
    await authorsTask; // 读取豆瓣出错时，作者查询照常做完
  } finally {
    busy = false;
    bgText = '';
    authorText = '';
    await saveMeta({ parserVersion: PARSER_VERSION });
    await refreshList();
    await renderStatus();
    await renderFoot();
  }
}

// 第一次读取：用大卡片显示进度
async function firstSync(uid) {
  if (busy) return;
  busy = true; foreground = true; stopRequested = false; lastError = null;
  await saveMeta({ uid });
  await renderStatus({});
  $('foot').innerHTML = '';
  try {
    await sync(uid, 'full', null, (info) => renderStatus(info));
  } catch (e) {
    lastError = e.message || String(e);
    console.error('[douban-tags]', e);
  } finally {
    busy = false; foreground = false;
    await saveMeta({ parserVersion: PARSER_VERSION });
    await refreshList();
    await renderStatus();
    await renderFoot();
  }
  if (!stopRequested && !lastError) background([], uid); // 接着在后台查作者归属
}

// 打开面板时自动决定要做什么
async function autoSync() {
  const meta = await loadMeta();
  const count = Object.keys(await loadItems()).length;
  if (!meta.uid || !count) return;
  const now = Date.now();
  if (meta.progress) {
    // 上次后台任务没做完：接着做
    return background([{ mode: meta.progress.mode, lists: meta.progress.sig ? meta.progress.sig.split(',').map(Number) : null }], meta.uid);
  }
  if (!meta.lastFull || now - meta.lastFull > FULL_EVERY_MS) return background([{ mode: 'full' }], meta.uid);
  if (!meta.lastSync || now - meta.lastSync > UPDATE_EVERY_MS) return background([{ mode: 'update' }], meta.uid);
  return background([], meta.uid); // 只补查还没查过的作者
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
  // 老用户第一次升级到自动同步：以上次同步时间作为完整读取时间，避免一打开就重读全部
  if (meta.lastSync && !meta.lastFull) await saveMeta({ lastFull: meta.lastSync });
  await refreshList();
  await renderStatus();
  await renderFoot();
  autoSync();
})();
