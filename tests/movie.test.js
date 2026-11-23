// 影视：电影/电视剧区分、规则题材、AI 提示词与校验、同一部只问一次、显示时套用。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lowConfidenceMovies, movieTagsFor, ruleForm, movieSeriesKey, genreTopics, movieSystemPrompt, movieUserPrompt, validateMovie,
  movieGroupsToAsk, classifyMoviesWithLlm, moviesNeedingLlm, crossCheck, applyMovieTopics } from '../app/movie-topics.js';

const fakeFetch = (replies) => {
  const calls = [];
  const fn = async (url, init) => {
    calls.push(JSON.parse(init.body));
    const r = replies.shift();
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(r) } }] }) };
  };
  fn.calls = calls;
  return fn;
};

test('电视剧：片名带第几季，或时长写单集', () => {
  assert.equal(ruleForm({ title: '白莲花度假村 第二季' }), '电视剧');
  assert.equal(ruleForm({ title: 'Fargo Season 3' }), '电视剧');
  assert.equal(ruleForm({ title: '安检', raw: '2021-12-21(波兰) / 阿德里安娜 / 波兰 / 10分钟（单集） / 爱情' }), '电视剧');
  assert.equal(ruleForm({ title: '教父', raw: '1972-03-24(美国) / 马龙·白兰度 / 美国 / 犯罪 / 剧情 / 175分钟' }), null);
});

test('同一部：不同季合一组；同名电影按导演区分', () => {
  assert.equal(movieSeriesKey({ title: '请回答1988 第一季' }), movieSeriesKey({ title: '请回答1988 第二季' }));
  assert.notEqual(movieSeriesKey({ title: '小妇人', directors: ['葛韦格'] }), movieSeriesKey({ title: '小妇人', directors: ['阿姆斯特朗'] }));
});

test('规则题材：按豆瓣类型粗分', () => {
  assert.deepEqual(genreTopics(['剧情', '传记', '战争']), { topics: ['真实改编', '战争与历史'], subtopics: ['真实改编/人物传记', '战争与历史/其他'] });
  assert.deepEqual(genreTopics(['喜剧', '爱情']), { topics: [], subtopics: [] });
});

test('提示词与校验', () => {
  const sp = movieSystemPrompt();
  assert.ok(sp.includes('json') && sp.includes('战争与历史：一战') && sp.includes('confidence'));
  const up = JSON.parse(movieUserPrompt([{ id: '1', title: '辛德勒的名单', directors: ['斯皮尔伯格'], year: '1993', countries: ['美国'], genres: ['剧情', '历史'] }]));
  assert.deepEqual(up, [{ id: '1', title: '辛德勒的名单', director: '斯皮尔伯格', year: '1993', country: '美国', genres: '剧情、历史' }]);
  assert.deepEqual(validateMovie({ topics: ['战争与历史', '乱写'], subtopics: ['战争与历史/二战', '犯罪/黑帮'], form: '电影', confidence: '高' }),
    { topics: ['战争与历史'], subtopics: ['战争与历史/二战'], form: '电影', confidence: '高' });
  assert.deepEqual(validateMovie({ topics: ['政治与权力'], form: '综艺', confidence: '很高' }),
    { topics: ['政治与权力'], subtopics: [], form: null, confidence: '低' });
});

test('批量归类：不同季只问一次，结果套给每一季', async () => {
  const items = {
    'movie:1': { key: 'movie:1', id: '1', type: 'movie', title: '请回答1988 第一季' },
    'movie:2': { key: 'movie:2', id: '2', type: 'movie', title: '请回答1988 第二季' },
    'movie:3': { key: 'movie:3', id: '3', type: 'movie', title: '辛德勒的名单', directors: ['斯皮尔伯格'], genres: ['剧情', '历史'] },
    'book:9': { key: 'book:9', id: '9', type: 'book', title: '书' },
  };
  assert.equal(movieGroupsToAsk(items, {}).length, 2);
  const f = fakeFetch([{ results: [
    { id: '1', form: '电视剧', topics: ['成长与家庭'], subtopics: ['成长与家庭/青春成长'], confidence: '高' },
    { id: '3', form: '电影', topics: ['战争与历史', '真实改编'], subtopics: ['战争与历史/二战', '真实改编/真实事件'], confidence: '高' },
  ] }]);
  const cache = {};
  await classifyMoviesWithLlm({ items, cache, settings: { apiKey: 'k' }, save: async () => {}, fetchImpl: f });
  assert.equal(f.calls.length, 1);
  assert.deepEqual(cache['movie:2'].subtopics, ['成长与家庭/青春成长']);
  assert.equal(moviesNeedingLlm(items, cache).length, 0);
});

test('显示时套用：AI 把握低用规则；电视剧识别；类型对不上标待核', () => {
  const items = {
    'movie:1': { key: 'movie:1', id: '1', type: 'movie', title: '某冷门片', genres: ['剧情', '战争'] },
    'movie:2': { key: 'movie:2', id: '2', type: 'movie', title: '某剧', genres: ['剧情'] },
    'movie:3': { key: 'movie:3', id: '3', type: 'movie', title: '某剧 第二季', genres: ['剧情'] },
  };
  const llm = {
    'movie:1': { topics: ['政治与权力'], subtopics: [], form: '电影', confidence: '低' },
    'movie:2': { topics: ['社会议题'], subtopics: ['社会议题/女性'], form: '电视剧', confidence: '中' },
  };
  applyMovieTopics(items, llm);
  assert.equal(items['movie:1'].topicSource, 'rule');
  assert.deepEqual(items['movie:1'].topics, ['战争与历史']);
  assert.equal(items['movie:2'].form, '电视剧');
  assert.equal(items['movie:3'].form, '电视剧');
  assert.deepEqual(items['movie:3'].topics, items['movie:2'].topics); // 第一季不带季数，也和第二季合成一组
  assert.deepEqual(crossCheck(['科幻题材', '战争与历史'], ['剧情', '爱情']), ['科幻题材']); // 战争与历史不核
});

import { parseMovieDetailPage } from '../app/details.js';

test('影视详情页：criteria 里的演职员名字去掉，只留标签', () => {
  const html = `<div id="info"><a href="/celebrity/1023040/" rel="v:directedBy">陈凯歌</a>
    <a href="/personage/27245046/" rel="v:starring">张国荣</a><span class='attrs'><a href="/celebrity/1/">雷汉</a></span></div>
    <script>var criteria = '7:文革|7:张国荣|7:雷汉|7:剧情|7:同志|7:陈凯歌|7:历史|3:/subject/1291546/';</script>
    <span property="v:votes">2467728</span>`;
  assert.deepEqual(parseMovieDetailPage(html), { tags: ['文革', '剧情', '同志', '历史'], votes: 2467728 });
});

test('把握低的影视才去读详情页；读到标签后会重问，标签会发给 AI', () => {
  const items = {
    'movie:1': { key: 'movie:1', id: '1', type: 'movie', title: '米花之味', directors: ['鹏飞'] },
    'movie:2': { key: 'movie:2', id: '2', type: 'movie', title: '霸王别姬', directors: ['陈凯歌'] },
  };
  const cache = { 'movie:1': { confidence: '低', topics: [] }, 'movie:2': { confidence: '高', topics: ['战争与历史'] } };
  assert.deepEqual(lowConfidenceMovies(items, cache, {}).map((i) => i.key), ['movie:1']);
  const details = { 'movie:1': { tags: ['米花之味', '留守儿童', '云南', '鹏飞', '剧情'] } };
  assert.deepEqual(lowConfidenceMovies(items, cache, details), []);
  assert.deepEqual(movieTagsFor(items['movie:1'], details), ['留守儿童', '云南', '剧情']);
  const up = JSON.parse(movieUserPrompt([{ id: '1', title: '米花之味', tags: ['留守儿童'] }, { id: '2', title: '霸王别姬' }]));
  assert.deepEqual(up[0].tags, ['留守儿童']);
  assert.equal('tags' in up[1], false);
  assert.ok(movieSystemPrompt().includes('阳光灿烂的日子'));
});
