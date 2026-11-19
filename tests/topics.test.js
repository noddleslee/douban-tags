// 详情页解析、豆瓣标签清洗、题材归并、冷门书。标签样本来自真实详情页（2026-11）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDetailPage, booksNeedingDetails } from '../app/details.js';
import { cleanTags, topicsOf, classify, isObscure, applyDetails, OBSCURE_TAG } from '../app/topics.js';

const SUSHI = ['东野圭吾', '推理', '日本', '東野圭吾', '小说', '推理小说', '悬疑', '日本文学', '宿命', '日本推理'];
const ART = ['艺术', '艺术史', '贡布里希', '艺术的故事', '美术学', '文化', '历史', '经典', '美学', '英国'];
const PSY = ['心理学', '心理', '批判性思维', '思维', '科学', '成长', '思想', '科学思维', '哲学·逻辑学·批判性思维', '科普'];

test('详情页：从脚本里取出常用标签和评价人数', () => {
  const html = `<script>var criteria = '7:推理|7:日本|7:小说|3:/subject/3259440/';</script>
    <div id="interest_sectl"><a href="collections"><span property="v:votes">123456</span>人评价</a></div>`;
  assert.deepEqual(parseDetailPage(html), { tags: ['推理', '日本', '小说'], votes: 123456 });
  assert.deepEqual(parseDetailPage('<html>评价人数不足</html>'), { tags: [], votes: 0 });
  assert.deepEqual(parseDetailPage("criteria = '7:社会&amp;政治|7:历史'").tags, ['社会&政治', '历史']);
});

test('标签清洗：去掉作者名、书名、国家、简繁重复、空泛词', () => {
  assert.deepEqual(cleanTags(SUSHI, { authors: ['东野圭吾'], title: '宿命' }),
    ['推理', '小说', '推理小说', '悬疑', '日本文学', '日本推理']);
  const art = cleanTags(ART, { authors: ['贡布里希'], title: '艺术的故事' });
  assert.ok(!art.includes('贡布里希') && !art.includes('艺术的故事') && !art.includes('经典') && !art.includes('英国'));
});

test('题材归并', () => {
  const t1 = classify(cleanTags(SUSHI, { authors: ['东野圭吾'], title: '宿命' }));
  assert.ok(t1.topics.includes('小说') && t1.subtopics.includes('小说/推理悬疑'));
  const t2 = topicsOf(cleanTags(ART, { authors: ['贡布里希'], title: '艺术的故事' }));
  assert.ok(t2.includes('艺术'));
  const t3 = topicsOf(cleanTags(PSY, { title: '这才是心理学' }));
  assert.ok(t3.includes('心理学') && t3.includes('科普'));
  assert.ok(!t3.includes('小说'));
  assert.ok(topicsOf(['回忆录', '台湾']).includes('传记回忆录'));
  assert.ok(topicsOf(['女性主义', '社会学']).includes('女性主义'));
  // 小说里带"历史"标签的，归为历史小说，不算历史
  const novel = classify(['俄罗斯文学', '肖洛霍夫', '小说', '历史']);
  assert.ok(novel.subtopics.includes('小说/历史小说') && !novel.topics.includes('历史'));
  assert.ok(topicsOf(['历史', '近代史', '传记']).includes('历史'));
  // 泛词只在排名靠前的标签里才算：第 8 个标签"历史"不算
  assert.ok(!topicsOf(['心理学', '心理', '心理学入门', '科普', '心理學', '科学', '哲学心理', '历史']).includes('历史'));
  // 游记即使被人打了"中文小说"，也不算小说
  assert.ok(!topicsOf(['旅行文学', '中亚', '游记', '旅行', '中文小说']).includes('小说'));
});

test('二级题材：没命中任何二级的归入"其他"，没有二级的一级不出二级', () => {
  assert.deepEqual(classify(['小说', '日本文学']).subtopics, ['小说/其他']);
  assert.deepEqual(classify(['女性主义']).subtopics, []);
  assert.ok(classify(['小说', '科幻', '雨果奖']).subtopics.includes('小说/科幻'));
  assert.ok(classify(['历史', '民国', '近代史']).subtopics.includes('历史/中国近现代史'));
  // 爱情、犯罪只在小说里算二级，不会把非小说带进小说
  assert.ok(!topicsOf(['社会学', '爱情', '情感']).includes('小说'));
  assert.ok(classify(['小说', '爱情']).subtopics.includes('小说/爱情'));
});

test('2026-11 核查后的修正', () => {
  assert.ok(!topicsOf(cleanTags(['传记', '中国戏剧出版社', '电影'])).includes('艺术')); // 出版社名不算
  assert.ok(!cleanTags(['北京大学出版社', '中华书局', '后浪', '历史']).some((t) => /出版社|书局|后浪/.test(t)));
  assert.ok(!topicsOf(['个人管理', '时间管理', '思维']).includes('经济管理'));
  assert.ok(topicsOf(['个人管理', '时间管理']).includes('个人成长'));
  assert.ok(!topicsOf(['心理学', '心理学入门']).includes('教材工具书'));
  assert.ok(!topicsOf(['写作', '写作指南']).includes('文学评论'));
  const found = classify(['科幻', '科幻小说', '美国', '小说', '心理史学']);
  assert.ok(!found.topics.includes('历史') && !found.subtopics.includes('小说/历史小说'));
  assert.ok(!classify(['拉美文学', '魔幻现实主义', '小说']).subtopics.includes('小说/奇幻'));
  assert.ok(!topicsOf(['电影原著', '小说', '美国文学']).includes('电影'));
  const comic = topicsOf(['图像小说', '漫画', '科幻']);
  assert.ok(comic.includes('漫画绘本'));
  assert.ok(topicsOf(['摄影', '画册', '老照片']).includes('艺术') && !topicsOf(['画册']).includes('漫画绘本'));
  assert.ok(!topicsOf(['写作', '修行']).includes('宗教'));
  assert.ok(topicsOf(['茅盾文学奖', '当代']).includes('小说'));
  assert.ok(topicsOf(['语言学', '文字']).includes('语言文字'));
});

test('冷门书：评价人数少或标签太少', () => {
  assert.equal(isObscure({ tags: SUSHI, votes: 50000 }), false);
  assert.equal(isObscure({ tags: SUSHI, votes: 20 }), true);
  assert.equal(isObscure({ tags: ['历史'], votes: 5000 }), true);
  assert.equal(isObscure({ tags: [], votes: 0, missing: true }), false); // 已下架的不算
});

test('显示时套用：书籍加上题材和豆瓣标签，冷门书归入题材', () => {
  const items = {
    'book:1': { key: 'book:1', id: '1', type: 'book', title: '宿命', authors: ['东野圭吾'] },
    'book:2': { key: 'book:2', id: '2', type: 'book', title: '某冷门书', authors: ['某人'] },
    'book:3': { key: 'book:3', id: '3', type: 'book', title: '还没读详情', authors: ['某人'] },
    'movie:4': { key: 'movie:4', id: '4', type: 'movie', title: '某电影', genres: ['剧情'] },
  };
  const details = { 'book:1': { tags: SUSHI, votes: 80000 }, 'book:2': { tags: ['历史'], votes: 12 } };
  applyDetails(items, details);
  assert.ok(items['book:1'].subtopics.includes('小说/推理悬疑'));
  assert.ok(items['book:2'].topics.includes(OBSCURE_TAG));
  assert.deepEqual(items['book:3'].topics, []);
  assert.equal(items['movie:4'].topics, undefined);
  assert.deepEqual(booksNeedingDetails(items, details).map((x) => x.key), ['book:3']);
});
