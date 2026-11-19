// AI 归类：提示词、结果校验、调用接口（用假的 fetch）、缓存、上下册合并。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { systemPrompt, userPrompt, validate, askBatch, classifyWithLlm, booksNeedingLlm, bookSig, groupsToAsk, LlmError } from '../app/llm.js';
import { applyDetails, seriesKey, refTags, fillSubs } from '../app/topics.js';

const fakeFetch = (replies) => {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
    const r = replies.shift();
    if (typeof r === 'number') return { ok: false, status: r, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: typeof r === 'string' ? r : JSON.stringify(r) } }] }) };
  };
  fn.calls = calls;
  return fn;
};

test('提示词：含题材清单、二级定义和 json 字样；用户消息是书名、作者、参考标签', () => {
  const sp = systemPrompt();
  assert.ok(sp.includes('json') && sp.includes('小说：推理悬疑') && sp.includes('近现代小说') && sp.includes('女性主义'));
  const up = JSON.parse(userPrompt([{ id: '1', title: '长安十二时辰（上）', authors: ['马伯庸'], tags: ['悬疑', '历史小说'], publisher: 'x' }]));
  assert.deepEqual(up, [{ id: '1', title: '长安十二时辰（上）', author: '马伯庸', tags: ['悬疑', '历史小说'] }]);
});

test('参考标签去重：简繁相同、包含前面标签的只留一个', () => {
  assert.deepEqual(refTags(['推理', '小说', '推理小说', '悬疑', '日本文学', '日本推理', '歷史', '历史']), ['推理', '小说', '悬疑', '日本文学', '歷史']);
  assert.equal(refTags(Array.from({ length: 20 }, (_, i) => `标签${'甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉'[i]}`)).length, 10);
});

test('小说不同时归历史一级（兜底）', () => {
  assert.deepEqual(validate({ topics: ['小说', '历史'], subtopics: ['小说/历史小说', '历史/世界史'] }),
    { topics: ['小说'], subtopics: ['小说/历史小说'] });
});

test('AI 缺二级时用豆瓣标签补', () => {
  assert.deepEqual(fillSubs(['小说'], ['小说/其他'], ['小说', '悬疑', '推理']), ['小说/推理悬疑']);
  assert.deepEqual(fillSubs(['小说'], ['小说/科幻'], ['小说', '悬疑']), ['小说/科幻']); // AI 给了就不动
  assert.deepEqual(fillSubs(['小说'], ['小说/其他'], ['小说']), ['小说/其他']);
});

test('结果校验：清单外的词丢掉，二级必须属于选中的一级，缺二级补"其他"', () => {
  assert.deepEqual(validate({ topics: ['小说', '奇怪题材'], subtopics: ['小说/推理悬疑', '历史/世界史', '小说/乱写'] }),
    { topics: ['小说'], subtopics: ['小说/推理悬疑'] });
  assert.deepEqual(validate({ topics: ['历史', '女性主义'], subtopics: [] }), { topics: ['历史', '女性主义'], subtopics: ['历史/其他'] });
  assert.deepEqual(validate(null), { topics: [], subtopics: [] });
});

test('调用接口：请求格式正确；空内容会重试；401 报 Key 错误', async () => {
  const f = fakeFetch(['   ', { results: [{ id: '1', topics: ['小说'], subtopics: ['小说/历史小说'] }] }]);
  const out = await askBatch([{ id: '1', title: '长安十二时辰', authors: ['马伯庸'] }], { apiKey: 'sk-test' }, f);
  assert.deepEqual(out['1'], { topics: ['小说'], subtopics: ['小说/历史小说'] });
  assert.equal(f.calls.length, 2);
  const c = f.calls[0];
  assert.equal(c.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(c.headers.Authorization, 'Bearer sk-test');
  assert.equal(c.body.model, 'deepseek-flash');
  assert.deepEqual(c.body.response_format, { type: 'json_object' });
  assert.deepEqual(c.body.thinking, { type: 'disabled' });
  await assert.rejects(askBatch([{ id: '1', title: 'x' }], { apiKey: 'bad' }, fakeFetch([401])), (e) => e instanceof LlmError && e.code === 'AUTH');
  await assert.rejects(askBatch([{ id: '1', title: 'x' }], { apiKey: 'k' }, fakeFetch([402])), (e) => e.code === 'BALANCE');
});

test('批量归类：分批、存缓存；已问过且书名作者没变的不再问', async () => {
  const items = {};
  for (let i = 1; i <= 12; i++) items[`book:${i}`] = { key: `book:${i}`, id: String(i), type: 'book', title: `书${i}`, authors: ['某人'] };
  items['movie:9'] = { key: 'movie:9', id: '9', type: 'movie', title: '电影' };
  const reply = (ids) => ({ results: ids.map((id) => ({ id, topics: ['历史'], subtopics: ['历史/世界史'] })) });
  const f = fakeFetch([reply(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']), reply(['11'])]); // 第 12 本没返回：当作拿不准
  const cache = {};
  let saves = 0;
  await classifyWithLlm({ items, cache, settings: { apiKey: 'k' }, save: async () => { saves++; }, fetchImpl: f });
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].body.messages[1].content.includes('书10'), true);
  assert.equal(saves, 2);
  assert.deepEqual(cache['book:1'].topics, ['历史']);
  assert.deepEqual(cache['book:12'].topics, []);
  assert.equal(cache['book:1'].sig, bookSig(items['book:1'], {}));
  assert.equal(booksNeedingLlm(items, cache).length, 0);
  items['book:3'].title = '书3（修订版）';
  assert.deepEqual(booksNeedingLlm(items, cache).map((i) => i.key), ['book:3']);
});

test('同一部书只问一次：多版本、上下册、分册合成一组，结果套给每一本', async () => {
  const items = {
    'book:1': { key: 'book:1', id: '1', type: 'book', title: '状元媒', authors: ['叶广芩'] },
    'book:2': { key: 'book:2', id: '2', type: 'book', title: '状元媒', authors: ['叶广芩'] },
    'book:3': { key: 'book:3', id: '3', type: 'book', title: '大医·破晓篇', authors: ['马伯庸'] },
    'book:4': { key: 'book:4', id: '4', type: 'book', title: '大医·日出篇', authors: ['马伯庸'] },
    'book:5': { key: 'book:5', id: '5', type: 'book', title: '活着', authors: ['余华'] },
  };
  const details = { 'book:2': { tags: ['小说', '北京', '京味'] }, 'book:3': { tags: ['小说', '医学'] }, 'book:4': { tags: ['历史', '民国'] } };
  const groups = groupsToAsk(items, {}, details);
  assert.equal(groups.length, 3);
  const g = groups.find((x) => x.members.length === 2 && x.title === '状元媒');
  assert.equal(g.id, '2'); // 标签多的那本当代表
  const dayi = groups.find((x) => x.title.startsWith('大医'));
  assert.deepEqual(dayi.tags.sort(), ['医学', '历史', '小说', '民国'].sort());
  const f = fakeFetch([{ results: groups.map((x) => ({ id: x.id, topics: ['小说'], subtopics: ['小说/近现代小说'] })) }]);
  const cache = {};
  await classifyWithLlm({ items, cache, details, settings: { apiKey: 'k' }, save: async () => {}, fetchImpl: f });
  assert.equal(f.calls.length, 1);
  assert.equal(JSON.parse(f.calls[0].body.messages[1].content).length, 3);
  assert.deepEqual(cache['book:1'].subtopics, cache['book:2'].subtopics);
  assert.deepEqual(cache['book:3'].subtopics, ['小说/近现代小说']);
  assert.equal(booksNeedingLlm(items, cache, details).length, 0);
  details['book:5'] = { tags: ['小说', '余华'] }; // 标签变了 → 重新问
  assert.deepEqual(booksNeedingLlm(items, cache, details).map((i) => i.key), ['book:5']);
});

test('显示时套用：有 AI 结果用 AI 的，AI 拿不准用规则；上下册合并成同一组题材', () => {
  assert.equal(seriesKey({ title: '长安十二时辰（上）', authors: ['马伯庸'] }), seriesKey({ title: '长安十二时辰(下)', authors: ['马伯庸'] }));
  assert.notEqual(seriesKey({ title: '活着', authors: ['余华'] }), seriesKey({ title: '活着', authors: ['别人'] }));
  const items = {
    'book:1': { key: 'book:1', id: '1', type: 'book', title: '长安十二时辰（上）', authors: ['马伯庸'] },
    'book:2': { key: 'book:2', id: '2', type: 'book', title: '长安十二时辰（下）', authors: ['马伯庸'] },
    'book:3': { key: 'book:3', id: '3', type: 'book', title: '某书', authors: ['某人'] },
  };
  const details = {
    'book:1': { tags: ['小说', '悬疑', '唐朝', '历史'], votes: 60000 },
    'book:2': { tags: ['小说', '悬疑', '架空小说'], votes: 60000 },
    'book:3': { tags: ['女性主义', '社会学'], votes: 10 },
  };
  const llm = {
    'book:1': { topics: ['小说'], subtopics: ['小说/推理悬疑', '小说/历史小说'] },
    'book:3': { topics: [], subtopics: [] }, // 拿不准
  };
  applyDetails(items, details, llm);
  assert.deepEqual(items['book:1'].topics, ['小说']);
  assert.equal(items['book:1'].topicSource, 'ai');
  assert.deepEqual(items['book:1'].subtopics, items['book:2'].subtopics); // 上下册一致
  assert.ok(items['book:2'].subtopics.includes('小说/历史小说') && !items['book:2'].subtopics.includes('小说/网络小说'));
  assert.ok(items['book:3'].topics.includes('女性主义') && items['book:3'].topics.includes('冷门书'));
  assert.equal(items['book:3'].topicSource, 'rule');
});
