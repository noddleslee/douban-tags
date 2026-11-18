// 作者文化归属的判断规则。人物数据取自维基数据的真实条目（2026-11）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideRegion, regionOfIds, titleCore, applyAuthorRegions, authorsToLookup } from '../app/authors.js';

test('地区编号：越具体越优先', () => {
  assert.equal(regionOfIds(['Q148', 'Q1054923', 'Q701967']), 'hk'); // 香港大学
  assert.equal(regionOfIds(['Q148', 'Q865']), 'tw'); // 台湾岛
  assert.equal(regionOfIds(['Q13426199']), 'cn'); // 中华民国（1912–1949）
  assert.equal(regionOfIds(['Q30']), null);
});

test('白先勇：简介写台湾', () => {
  assert.equal(decideRegion({ desc: '臺灣知名劇作家', citizenship: ['Q13426199', 'Q865'] }).region, '中国台湾');
});

test('林夕：简介写香港', () => {
  assert.equal(decideRegion({ desc: '香港著名作词家', citizenship: ['Q1054923', 'Q148'] }).region, '中国香港');
});

test('许倬云：美籍华裔，大部分学校在台湾', () => {
  const r = decideRegion({
    desc: '美籍华裔历史学家',
    citizenship: ['Q30', 'Q13426199', 'Q865'],
    citizenshipLabels: ['美国', '中华民国', '中华民国'],
    schools: [
      { regions: ['Q32746', 'Q865'], start: '+1949' },
      { regions: ['Q131252', 'Q30'], start: '+1956' },
      { regions: ['Q32746', 'Q865'], start: '+1953' },
    ],
  });
  assert.deepEqual(r, { region: '中国台湾', reason: '就读学校' });
});

test('黄仁宇：美籍华裔，大部分学校在大陆', () => {
  const r = decideRegion({
    desc: '美籍华裔历史学家 (1918–2000)',
    citizenship: ['Q30'], citizenshipLabels: ['美国'],
    schools: [{ regions: ['Q230492', 'Q30'] }, { regions: ['Q254204', 'Q148'] }, { regions: ['Q26239', 'Q13426199'] }],
  });
  assert.equal(r.region, '中国大陆');
});

test('华人学者没有学校信息时看出生地', () => {
  const r = decideRegion({ desc: '美籍华人作家', citizenship: ['Q30'], citizenshipLabels: ['美国'], schools: [], birthRegions: ['Q68744', 'Q148'] });
  assert.deepEqual(r, { region: '中国大陆', reason: '出生地' });
});

test('鲁迅：简介写中国，学校都在日本也不影响', () => {
  const r = decideRegion({
    desc: '中国现代文学家', citizenship: ['Q8733', 'Q13426199'],
    schools: [{ regions: ['Q1062129', 'Q17'] }, { regions: ['Q9328584', 'Q17'] }],
  });
  assert.equal(r.region, '中国大陆');
});

test('简介没有地区时看国籍', () => {
  assert.equal(decideRegion({ desc: '', citizenship: ['Q865'] }).region, '中国台湾');
  assert.equal(decideRegion({ desc: '', citizenship: ['Q148'] }).region, '中国大陆');
});

test('鲍大可：外国人按国籍', () => {
  assert.deepEqual(decideRegion({ desc: '美國記者', citizenship: ['Q30'], citizenshipLabels: ['美国'] }), { region: '美国', reason: '国籍' });
});

test('信息不足时返回 null', () => {
  assert.equal(decideRegion({ desc: '', citizenship: [] }), null);
});

test('书名主干', () => {
  assert.equal(titleCore('《台北人》'), '台北人');
  assert.equal(titleCore('欢迎光临社会学（第11版）'), '欢迎光临社会学');
  assert.equal(titleCore('中国西部四十年：一个美国人的观察'), '中国西部四十年');
  assert.equal(titleCore('X'), null);
});

test('只替换推断出来的"中国大陆"，不动豆瓣上写明的国籍', () => {
  const items = {
    a: { type: 'book', authors: ['白先勇'], countries: ['中国大陆'], countryGuess: true },
    b: { type: 'book', authors: ['哈珀·李'], countries: ['美国'], countryGuess: false },
    c: { type: 'book', authors: ['余华'], countries: ['中国大陆'], countryGuess: true },
    d: { type: 'movie', cast: ['某人'], countries: ['中国大陆'] },
  };
  const cache = { 白先勇: { region: '中国台湾' }, 余华: { region: null } };
  assert.equal(applyAuthorRegions(items, cache), 1);
  assert.deepEqual(items.a.countries, ['中国台湾']);
  assert.deepEqual(items.b.countries, ['美国']);
  assert.deepEqual(items.c.countries, ['中国大陆']);
});

test('需要查询的作者：没查过的，或者没查到且已超过 30 天的', () => {
  const now = Date.now();
  const items = {
    a: { type: 'book', authors: ['白先勇'], countryGuess: true, title: '台北人' },
    b: { type: 'book', authors: ['余华'], countryGuess: true, title: '活着' },
    c: { type: 'book', authors: ['杨照'], countryGuess: true, title: '我想遇见你的人生' },
    d: { type: 'book', authors: ['哈珀·李'], countryGuess: false, title: '杀死一只知更鸟' },
  };
  const cache = { 白先勇: { region: '中国台湾', at: now }, 余华: { region: null, at: now - 31 * 86400000 } };
  assert.deepEqual(authorsToLookup(items, cache, now).map((x) => x.name).sort(), ['余华', '杨照']);
});
