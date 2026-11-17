// 解析豆瓣列表页里的简介文字，拆成可筛选的字段。
// 纯字符串函数，不依赖浏览器，可以在 node 里测试。

export const GENRES = new Set([
  '剧情', '喜剧', '动作', '爱情', '科幻', '动画', '悬疑', '惊悚', '恐怖', '犯罪',
  '同性', '音乐', '歌舞', '传记', '历史', '战争', '西部', '奇幻', '冒险', '灾难',
  '武侠', '古装', '家庭', '儿童', '纪录片', '运动', '黑色电影', '短片', '情色',
  '真人秀', '脱口秀', '戏曲', '鬼怪', '荒诞', '舞台艺术', '悬念',
]);

export const COUNTRIES = new Set([
  '中国', '中国大陆', '中国香港', '中国台湾', '中国澳门', '香港', '台湾', '澳门',
  '美国', '英国', '法国', '德国', '西德', '东德', '联邦德国', '民主德国', '日本', '韩国', '朝鲜',
  '泰国', '印度', '意大利', '西班牙', '葡萄牙', '加拿大', '澳大利亚', '新西兰',
  '俄罗斯', '苏联', '瑞典', '挪威', '丹麦', '芬兰', '冰岛', '荷兰', '比利时', '瑞士',
  '奥地利', '波兰', '捷克', '捷克斯洛伐克', '斯洛伐克', '匈牙利', '罗马尼亚', '保加利亚',
  '希腊', '土耳其', '伊朗', '以色列', '黎巴嫩', '埃及', '摩洛哥', '突尼斯', '阿尔及利亚',
  '南非', '尼日利亚', '肯尼亚', '塞内加尔', '巴西', '阿根廷', '墨西哥', '智利', '哥伦比亚',
  '秘鲁', '古巴', '委内瑞拉', '乌拉圭', '巴拉圭', '玻利维亚', '厄瓜多尔', '波多黎各',
  '多米尼加', '牙买加', '菲律宾', '印度尼西亚', '马来西亚', '新加坡', '越南', '柬埔寨',
  '缅甸', '老挝', '尼泊尔', '不丹', '巴基斯坦', '孟加拉国', '斯里兰卡', '哈萨克斯坦',
  '乌兹别克斯坦', '吉尔吉斯斯坦', '塔吉克斯坦', '蒙古', '格鲁吉亚', '亚美尼亚', '阿塞拜疆',
  '乌克兰', '白俄罗斯', '立陶宛', '拉脱维亚', '爱沙尼亚', '塞尔维亚', '克罗地亚',
  '斯洛文尼亚', '波黑', '南斯拉夫', '北马其顿', '马其顿', '阿尔巴尼亚', '黑山', '爱尔兰',
  '卢森堡', '摩纳哥', '马耳他', '塞浦路斯', '列支敦士登', '沙特阿拉伯', '阿联酋',
  '阿拉伯联合酋长国', '卡塔尔', '约旦', '伊拉克', '叙利亚', '巴勒斯坦', '阿富汗', '科威特',
]);

// 书籍作者国籍的简写 → 全称，和电影的国家标签合并
const SHORT_COUNTRY = {
  美: '美国', 英: '英国', 法: '法国', 德: '德国', 日: '日本', 韩: '韩国', 意: '意大利',
  俄: '俄罗斯', 加: '加拿大', 澳: '澳大利亚', 西: '西班牙', 葡: '葡萄牙', 荷: '荷兰',
  奥: '奥地利', 波: '波兰', 捷: '捷克', 匈: '匈牙利', 希: '希腊', 印: '印度', 以: '以色列',
  瑞典: '瑞典', 瑞士: '瑞士', 丹: '丹麦', 挪: '挪威', 芬: '芬兰', 比: '比利时', 爱: '爱尔兰',
  巴: '巴西', 阿: '阿根廷', 墨: '墨西哥', 智: '智利', 土: '土耳其', 伊: '伊朗', 埃: '埃及',
  新: '新西兰', 苏: '苏联', 清: '中国', 明: '中国', 宋: '中国', 唐: '中国', 汉: '中国',
  台: '中国台湾', 港: '中国香港', 中: '中国',
};

const REGION_ALIAS = { 香港: '中国香港', 台湾: '中国台湾', 澳门: '中国澳门' };

const DATE_RE = /^\d{4}(-\d{1,2}){0,2}(\s*\(.*\))?$/;
const DURATION_RE = /^\d+\s*分钟/;
const URL_RE = /^(https?:|www\.)|\.(com|org|net|cn|jp|kr|tv|co|io)(\/|$)/i;
const LANG_RE = /(语|话|对白)$/;
const CJK_RE = /[㐀-鿿]/;

export function splitParts(text) {
  return String(text || '')
    // 豆瓣用 " / " 分隔；网址里的 "/" 两边没有空格，不能拆
    .split(/\s+\/\s*|\s*\/\s+/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

export function normCountry(c) {
  return REGION_ALIAS[c] || c;
}

// "张抗俊 Hang-jun Jang" → "张抗俊"；纯外文名保持原样
export function normPerson(name) {
  let n = String(name || '').replace(/\s+/g, ' ').trim();
  if (CJK_RE.test(n)) n = n.replace(/\s+[A-Za-z].*$/, '');
  return n;
}

function yearOf(s) {
  const m = String(s).match(/(\d{4})/);
  return m ? Number(m[1]) : null;
}

export function decadeOf(year) {
  return year ? `${Math.floor(year / 10) * 10}年代` : null;
}

function uniq(arr) {
  return [...new Set(arr.filter(Boolean))];
}

// 电影简介格式（2026-11 实测）：
// 上映日期(地区)… / 演员… / 国家… / [官网] / 导演… / [日期] / 时长… / 片名… / 类型… / 编剧… / 语言…
export function parseMovieIntro(intro) {
  const p = splitParts(intro);
  const r = {
    year: null, countries: [], languages: [], genres: [], durationMin: null,
    cast: [], directors: [], writers: [],
  };
  if (!p.length) return r;

  let i = 0;
  const years = [];
  while (i < p.length && DATE_RE.test(p[i])) { years.push(yearOf(p[i])); i++; }

  const durIdx = p.findIndex((s, k) => k >= i && DURATION_RE.test(s));
  const limit = durIdx >= 0 ? durIdx : p.length;

  // 国家块：演员之后第一段连续的国家名
  let c0 = -1;
  for (let k = i; k < limit; k++) if (COUNTRIES.has(p[k])) { c0 = k; break; }
  let c1 = c0;
  if (c0 >= 0) { while (c1 < limit && COUNTRIES.has(p[c1])) c1++; }

  if (c0 >= 0) {
    r.cast = p.slice(i, c0);
    r.countries = p.slice(c0, c1);
    if (durIdx >= 0) {
      r.directors = p.slice(c1, durIdx).filter((s) => !URL_RE.test(s) && !DATE_RE.test(s));
    }
  }

  // 时长之后：片名… / 类型… / 编剧… / 语言…
  let k = durIdx >= 0 ? durIdx : (c1 >= 0 ? c1 : i);
  if (durIdx >= 0) {
    r.durationMin = parseInt(p[durIdx], 10);
    while (k < p.length && DURATION_RE.test(p[k])) k++;
  }
  let g0 = -1;
  for (let j = k; j < p.length; j++) if (GENRES.has(p[j])) { g0 = j; break; }
  let g1 = g0;
  if (g0 >= 0) { while (g1 < p.length && GENRES.has(p[g1])) g1++; r.genres = p.slice(g0, g1); }

  let langStart = p.length;
  const tailFloor = g1 >= 0 ? g1 : k;
  while (langStart - 1 >= tailFloor && LANG_RE.test(p[langStart - 1])) langStart--;
  r.languages = p.slice(langStart);
  if (g1 >= 0) r.writers = p.slice(g1, langStart);

  if (!r.cast.length && c0 < 0) r.cast = p.slice(i, durIdx >= 0 ? durIdx : (g0 >= 0 ? g0 : langStart));

  r.year = years.length ? Math.min(...years) : (yearOf(p.find((s) => DATE_RE.test(s)) || '') || null);
  r.countries = uniq(r.countries.map(normCountry));
  r.cast = uniq(r.cast.filter((s) => !URL_RE.test(s)).map(normPerson));
  r.directors = uniq(r.directors.map(normPerson));
  r.writers = uniq(r.writers.map(normPerson));
  r.languages = uniq(r.languages);
  r.genres = uniq(r.genres);
  return r;
}

const PRICE_RE = /^((USD|GBP|EUR|JPY|CNY|HKD|TWD|NT\$|HK\$|\$|£|€|¥)\s*)?\d+(\.\d+)?\s*(元|円|圆)?$/i;
const BOOK_DATE_RE = /^\d{4}(-\d{1,2}){0,2}$|^\d{4}年/;
const NAT_RE = /^\s*[[［【(（]\s*([^\]］】)）]{1,8})\s*[\]］】)）]\s*/;

function splitNames(s) {
  return String(s || '').split(/[、,，;；&]|\s+和\s+/).map((x) => x.trim()).filter(Boolean);
}

function cleanBookPerson(name) {
  return name
    .replace(NAT_RE, '')
    .replace(/[(（][^)）]*[)）]/g, '')
    .replace(/\s*(著|编著|主编|编|译|绘|撰)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// 书籍出版信息格式：作者 / [译者] / 出版社 / 出版日期 / [价格]
export function parseBookPub(pub) {
  const p = splitParts(pub);
  const r = { year: null, authors: [], translators: [], publisher: null, countries: [] };
  if (!p.length) return r;

  if (p.length > 1 && !BOOK_DATE_RE.test(p[p.length - 1]) && PRICE_RE.test(p[p.length - 1])) p.pop();
  if (p.length && BOOK_DATE_RE.test(p[p.length - 1])) r.year = yearOf(p.pop());
  if (p.length >= 2) r.publisher = p.pop();

  const authorRaw = splitNames(p[0] || '');
  for (const a of authorRaw) {
    const m = a.match(NAT_RE);
    if (m) {
      const nat = m[1].trim();
      r.countries.push(normCountry(SHORT_COUNTRY[nat] || nat));
    }
  }
  r.authors = uniq(authorRaw.map(cleanBookPerson));
  r.translators = uniq(p.slice(1).flatMap(splitNames).map(cleanBookPerson));
  r.countries = uniq(r.countries);
  return r;
}

// 豆瓣列表页里"标签: a b"
export function parseMyTags(text) {
  return uniq(String(text || '').replace(/^\s*标签\s*[:：]\s*/, '').split(/\s+/));
}

export function parseRating(className) {
  const m = String(className || '').match(/rating(\d)-t/);
  return m ? Number(m[1]) : null;
}

export function parseMarkDate(text) {
  const m = String(text || '').match(/\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
}
