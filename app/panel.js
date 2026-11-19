// 侧边栏面板：第一次读取、后台自动同步、作者文化归属查询。
import { loadItems, saveItems, loadMeta, saveMeta, clearAll, loadAuthors, saveAuthors, loadDetails, saveDetails, loadLlm, saveLlm, loadSettings, saveSettings } from './store.js';
import { classifyWithLlm, booksNeedingLlm, tagsFor, LLM_DEFAULTS } from './llm.js';
import { applyMovieTopics, classifyMoviesWithLlm, moviesNeedingLlm, crossCheck, genreTopics, ruleForm } from './movie-topics.js';
import { fetchDetails } from './details.js';
import { applyDetails, classify, cleanTags } from './topics.js';
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
let aiText = ''; // AI 归类的进度
let aiError = null;
let aiBusy = false;
let aiOpen = false; // AI 设置是否展开

// 开着 AI 并且填了 Key
const aiOn = (st) => !!(st.apiKey && st.enabled !== false);

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
  const settings = await loadSettings();
  const llm = aiOn(settings) ? await loadLlm() : null;
  applyDetails(items, await loadDetails(), llm);
  applyMovieTopics(items, llm);
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

// 正在填 AI 设置时不重绘底部，免得输入被冲掉；离开输入框后再补一次
let footPending = false;
document.addEventListener('focusout', (e) => {
  if (footPending && e.target.closest && e.target.closest('.dt-ai')) setTimeout(() => {
    if (!document.activeElement || !document.activeElement.closest('.dt-ai')) { footPending = false; renderFoot(); }
  }, 0);
});

async function renderFoot() {
  const active = document.activeElement;
  if (active && active.closest && active.closest('.dt-ai') && active.tagName === 'INPUT') { footPending = true; return; }
  const meta = await loadMeta();
  const count = Object.keys(await loadItems()).length;
  if (!count) { $('foot').innerHTML = ''; return; }
  const lines = [bgText, authorText, aiText].filter(Boolean).map(esc).join('<br>');
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
      <button class="dt-link-btn" id="ai-toggle" title="用 AI 判断书的题材">AI 归类</button>
    </span>${await aiPanelHtml()}`;
  bindAiPanel();
  $('ai-toggle').onclick = () => { aiOpen = !aiOpen; renderFoot(); };
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

// AI 归类设置区（在底部，点"AI 归类"展开）
async function aiPanelHtml() {
  const st = await loadSettings();
  const items = await loadItems();
  const books = Object.values(items).filter((i) => i.type === 'book').length;
  const llmCache = await loadLlm();
  const left = booksNeedingLlm(items, llmCache, await loadDetails()).length;
  const movies = Object.values(items).filter((i) => i.type === 'movie').length;
  const mLeft = moviesNeedingLlm(items, llmCache).length;
  const status = !st.apiKey ? '未开启：现在书的题材由关键词规则判断。填入 API Key 后改由 AI 判断，更准。'
    : st.enabled === false ? '已关闭：现在用关键词规则判断题材。'
      : `已开启：书 ${books - left} / ${books} 本、影视 ${movies - mLeft} / ${movies} 部已由 AI 归类${aiBusy ? '（进行中）' : ''}。AI 拿不准的仍用规则。`;
  const err = aiError ? `<p class="dt-err">${esc(aiError)}</p>` : '';
  if (!aiOpen) return err ? `<div class="dt-ai-mini">${err}</div>` : '';
  return `<div class="dt-ai">
    <p><strong>AI 归类</strong>　${esc(status)}</p>${err}
    <input class="dt-uid" id="ai-key" type="password" placeholder="DeepSeek API Key（sk- 开头）" value="${esc(st.apiKey || '')}" autocomplete="off">
    <details class="dt-ai-adv"><summary>换别的模型</summary>
      <input class="dt-uid" id="ai-base" placeholder="${esc(LLM_DEFAULTS.baseUrl)}" value="${esc(st.baseUrl || '')}">
      <input class="dt-uid" id="ai-model" placeholder="${esc(LLM_DEFAULTS.model)}" value="${esc(st.model || '')}">
      <p class="dt-hint">兼容 OpenAI 接口格式的服务都可以，填接口地址和模型名。非 DeepSeek 的地址需要在 manifest.json 里加上访问权限。</p>
    </details>
    <div class="dt-actions">
      <button class="dt-primary" id="ai-save">保存并开始</button>
      ${st.apiKey ? `<button class="dt-secondary" id="ai-off">${st.enabled === false ? '重新开启' : '关闭 AI'}</button>` : ''}
      <button class="dt-secondary" id="ai-export">导出对比表</button>
    </div>
    <p class="dt-hint">只会把书名和作者发给 AI 服务，API Key 只存在这个浏览器里。申请 Key：platform.deepseek.com/api_keys（需要充值，几百本书一次大约几分钱）。</p>
  </div>`;
}

function bindAiPanel() {
  if (!$('ai-save')) return;
  $('ai-save').onclick = async () => {
    const patch = { apiKey: $('ai-key').value.trim(), baseUrl: $('ai-base').value.trim(), model: $('ai-model').value.trim(), enabled: true };
    await saveSettings(patch);
    aiError = null;
    renderFoot();
    runAi();
  };
  if ($('ai-off')) $('ai-off').onclick = async () => {
    const st = await loadSettings();
    await saveSettings({ enabled: st.enabled === false });
    await refreshList(); renderFoot();
    if (st.enabled === false) runAi();
  };
  $('ai-export').onclick = exportCompare;
}

// 让 AI 给还没归类的书归类（只发书名和作者）
async function runAi() {
  const settings = await loadSettings();
  if (!aiOn(settings) || aiBusy) return;
  aiBusy = true;
  try {
    const cache = await loadLlm();
    const asked = await classifyWithLlm({
      items: await loadItems(), cache, details: await loadDetails(), settings, save: saveLlm,
      shouldStop: () => stopRequested,
      onProgress: ({ done, total }) => {
        aiText = total && done < total ? `AI 正在归类书的题材（${done} / ${total}）` : '';
        renderFoot(); refreshList();
      },
    });
    if (asked) await saveCompareFile(); // 这次有新归类的书：把对比表存到下载文件夹，方便核对
    // 影视：只发片名、导演、年份、国家、豆瓣类型
    const askedMovies = await classifyMoviesWithLlm({
      items: await loadItems(), cache, settings, save: saveLlm,
      shouldStop: () => stopRequested,
      onProgress: ({ done, total }) => {
        aiText = total && done < total ? `AI 正在归类影视题材（${done} / ${total}）` : '';
        renderFoot(); refreshList();
      },
    });
    if (askedMovies) await saveMovieCompareFile();
    aiError = null;
  } catch (e) {
    aiError = e.message || String(e);
    console.warn('[douban-tags] AI 归类', e);
  } finally {
    aiBusy = false; aiText = '';
    await refreshList(); renderFoot();
  }
}

// 对比表（CSV）：每本书发给 AI 的标签、规则题材、AI 原始题材、面板最终显示的题材
async function compareCsv() {
  const items = await loadItems();
  const details = await loadDetails();
  const llm = await loadLlm();
  const settings = await loadSettings();
  const shown = JSON.parse(JSON.stringify(items));
  applyDetails(shown, details, aiOn(settings) ? llm : null);
  const fmt = (t, s) => [...(t || []), ...(s || []).filter((x) => !x.endsWith('/其他'))].join(' ');
  const q = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const rows = [['豆瓣ID', '书名', '作者', '状态', '发给AI的豆瓣标签', '规则题材', 'AI原始题材', '面板显示', '来源', '规则与面板是否一致']];
  for (const it of Object.values(items)) {
    if (it.type !== 'book') continue;
    const d = details[it.key];
    const rule = d ? classify(cleanTags(d.tags, it)) : { topics: [], subtopics: [] };
    const ai = llm[it.key];
    const fin = shown[it.key];
    const a = fmt(rule.topics, rule.subtopics);
    const c = fmt((fin.topics || []).filter((t) => t !== '冷门书'), fin.subtopics);
    rows.push([it.id, it.title, (it.authors || []).join('、'), it.status, tagsFor(it, details).join(' '), a,
      ai ? (fmt(ai.topics, ai.subtopics) || '（拿不准）') : '（未归类）', c, fin.topicSource === 'ai' ? 'AI' : '规则', a === c ? '一致' : '不同']);
  }
  return '\ufeff' + rows.map((r) => r.map(q).join(',')).join('\n');
}

// 手动导出（点按钮）
async function exportCompare() {
  const day = new Date().toISOString().slice(0, 10);
  for (const [name, csv] of [[`豆瓣书影标签-题材对比-${day}.csv`, await compareCsv()], [`豆瓣书影标签-影视对比-${day}.csv`, await movieCompareCsv()]]) {
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

// 自动保存到 下载文件夹/douban-tags-data/，每次覆盖，不弹窗
async function saveDataFile(name, csv) {
  if (!chrome.downloads) return;
  try {
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    await chrome.downloads.download({ url, filename: `douban-tags-data/${name}`, conflictAction: 'overwrite', saveAs: false });
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) {
    console.warn('[douban-tags] 保存对比表失败', e);
  }
}
const saveCompareFile = async () => saveDataFile('题材对比.csv', await compareCsv());
const saveMovieCompareFile = async () => saveDataFile('影视对比.csv', await movieCompareCsv());

// 影视对比表：规则（按豆瓣类型）和 AI 的题材、电影/电视剧、AI 把握程度、和类型对不上的"待核"
async function movieCompareCsv() {
  const items = await loadItems();
  const llm = await loadLlm();
  const settings = await loadSettings();
  const shown = JSON.parse(JSON.stringify(items));
  applyMovieTopics(shown, aiOn(settings) ? llm : null);
  const fmt = (t, s) => [...(t || []), ...(s || []).filter((x) => !x.endsWith('/其他'))].join(' ');
  const q = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const rows = [['豆瓣ID', '片名', '导演', '年份', '国家', '豆瓣类型', '规则形式', 'AI形式', '规则题材', 'AI题材', 'AI把握', '面板显示', '来源', '待核']];
  for (const it of Object.values(items)) {
    if (it.type !== 'movie') continue;
    const ai = llm[it.key];
    const rule = genreTopics(it.genres);
    const fin = shown[it.key];
    rows.push([it.id, it.titleFull || it.title, (it.directors || []).join('、'), it.year, (it.countries || []).join('、'),
      (it.genres || []).join('、'), ruleForm(it) || '', ai ? (ai.form || '') : '', fmt(rule.topics, rule.subtopics),
      ai ? fmt(ai.topics, ai.subtopics) : '（未归类）', ai ? ai.confidence : '', fmt(fin.topics, fin.subtopics),
      fin.topicSource === 'ai' ? 'AI' : '规则', ai ? crossCheck(ai.topics, it.genres).join(' ') : '']);
  }
  return '\ufeff' + rows.map((r) => r.map(q).join(',')).join('\n');
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

// 补读书籍详情页
async function readDetails() {
  const details = await loadDetails();
  let n = 0;
  await fetchDetails({
    items: await loadItems(),
    details,
    save: saveDetails,
    shouldStop: () => stopRequested,
    onProgress: ({ done, total }) => {
      bgText = total ? `正在读取书籍详情，生成题材标签（${done} / ${total}）` : '';
      renderFoot();
      if (++n % 5 === 0) refreshList();
    },
  });
}

// 后台任务：读取豆瓣（依次执行 steps）和查询作者归属同时进行，互不等待。只在底部显示进度。
async function background(steps, uid) {
  if (busy) return;
  busy = true; foreground = false; stopRequested = false; lastError = null;
  // 作者查询访问的是维基百科，和读取豆瓣互不影响，所以一开始就并行做
  const authorsTask = lookupAuthors().catch((e) => console.warn('[douban-tags] 查询作者出错', e));
  const aiTask = runAi(); // AI 归类只发书名和作者给 AI 服务，和读取豆瓣互不影响
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
    // 读完书单后，补读还没读过的书籍详情页（豆瓣标签、评价人数），用来生成题材和冷门书标签
    if (!stopRequested) await readDetails();
    bgText = '';
    await authorsTask;
    // 这次同步新读到的书，作者还没查过的，补查一次
    if (!stopRequested) await lookupAuthors();
    await aiTask;
    if (!stopRequested) await runAi(); // 这次新读到的书
  } catch (e) {
    lastError = e.message || String(e);
    console.error('[douban-tags]', e);
    bgText = '';
    renderFoot();
    await authorsTask; // 读取豆瓣出错时，作者查询照常做完
    await aiTask;
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

// 插件文件夹里如果有 app/seed-details.json（预先读好的书籍详情），第一次打开时导入，省去后台读取的时间
async function importSeedDetails() {
  try {
    const res = await fetch(chrome.runtime.getURL('app/seed-details.json'));
    if (!res.ok) return;
    const seed = await res.json();
    const details = await loadDetails();
    let added = 0;
    for (const [k, v] of Object.entries(seed.items || {})) {
      if (!details[k]) { details[k] = { tags: v.tags || [], votes: v.votes || 0, at: seed._at || Date.now() }; added++; }
    }
    if (added) await saveDetails(details);
  } catch {
    // 没有初始数据文件：正常情况，忽略
  }
}

(async function init() {
  await reparseIfNeeded();
  await importSeedDetails();
  const meta = await loadMeta();
  if (!meta.uid) detectedUid = await detectUid();
  // 老用户第一次升级到自动同步：以上次同步时间作为完整读取时间，避免一打开就重读全部
  if (meta.lastSync && !meta.lastFull) await saveMeta({ lastFull: meta.lastSync });
  await refreshList();
  await renderStatus();
  await renderFoot();
  autoSync();
})();
