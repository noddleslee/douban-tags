// 运行：npm test
// 样本来自真实的豆瓣列表页（2026-11）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMovieIntro, parseBookPub, parseMyTags, parseRating, parseMarkDate, normPerson, decadeOf,
} from '../app/parser.js';

test('电影：泰剧，单一国家', () => {
  const r = parseMovieIntro('2026-08-22(泰国) / 塔纳波·里拉塔纳卡邹 / 洛雷娜·舒特 / 周泰然 / 农·瓦洛·汶淳 / 珍妮弗·基姆 / Kunkanich Khumkrong / 泰国 / 埃卡西·柴坤卡森苏克 / 101分钟 / 画中伊人 / 剧情 / 爱情 / 托萨风·利安堂 Tossaphon Riantong / 宛尼盼·翁波克朗 Waneepan Ounphoklang / 泰语');
  assert.equal(r.year, 2026);
  assert.deepEqual(r.countries, ['泰国']);
  assert.deepEqual(r.genres, ['剧情', '爱情']);
  assert.deepEqual(r.languages, ['泰语']);
  assert.equal(r.durationMin, 101);
  assert.deepEqual(r.directors, ['埃卡西·柴坤卡森苏克']);
  assert.equal(r.cast.length, 6);
  assert.equal(r.cast[1], '洛雷娜·舒特');
  assert.deepEqual(r.writers, ['托萨风·利安堂', '宛尼盼·翁波克朗']);
});

test('电影：没有导演字段、三个类型', () => {
  const r = parseMovieIntro('2026-09-11(泰国) / 洛雷娜·舒特 / 纳莎·泰查蒙卡拉皮瓦 / 泰国 / 帕察妮·扎鲁金达 / 45分钟 / 可以爱吗 / 剧情 / 爱情 / 同性 / 泰语');
  assert.deepEqual(r.genres, ['剧情', '爱情', '同性']);
  assert.deepEqual(r.directors, ['帕察妮·扎鲁金达']);
  assert.deepEqual(r.writers, []);
});

test('电影：没有导演，国家后直接是时长', () => {
  const r = parseMovieIntro('2026-06-28(泰国) / 帕努瓦·普利马尼楠 / 依莎亚·贺苏汪 / 泰国 / 60分钟 / 爱且衡生 / 剧情 / 泰语');
  assert.deepEqual(r.directors, []);
  assert.deepEqual(r.cast, ['帕努瓦·普利马尼楠', '依莎亚·贺苏汪']);
  assert.deepEqual(r.genres, ['剧情']);
});

test('电影：多个上映日期、两个时长、粤语', () => {
  const r = parseMovieIntro('2024-10-17(香港亚洲电影节) / 2024-11-09(中国香港) / 2024-12-14(中国大陆) / 黄子华 / 许冠文 / 卫诗雅 / 中国香港 / 陈茂贤 / 126分钟 / 140分钟(特别版) / 破·地狱 / 剧情 / 家庭 / 陈茂贤 Anselm Chan / 郑纬机 Wai Kei Cheng / 粤语');
  assert.equal(r.year, 2024);
  assert.deepEqual(r.countries, ['中国香港']);
  assert.deepEqual(r.directors, ['陈茂贤']);
  assert.equal(r.durationMin, 126);
  assert.deepEqual(r.genres, ['剧情', '家庭']);
  assert.deepEqual(r.writers, ['陈茂贤', '郑纬机']);
  assert.deepEqual(r.languages, ['粤语']);
});

test('电影：导演和时长之间夹着日期、多种语言', () => {
  const r = parseMovieIntro('2026-04-30(中国大陆) / 李思潼 / 王彦桐 / 中国大陆 / 蓝鸿春 / 2026-04-17 / 118分钟 / 剧情 / 家庭 / 蓝鸿春 Hongchun Lan / 杨冷 / 潮汕话 / 汉语普通话 / 泰语 / 英语');
  assert.deepEqual(r.directors, ['蓝鸿春']);
  assert.deepEqual(r.languages, ['潮汕话', '汉语普通话', '泰语', '英语']);
  assert.deepEqual(r.writers, ['蓝鸿春', '杨冷']);
});

test('电影：多国合拍、带官网网址', () => {
  const r = parseMovieIntro('2018-05-11(戛纳电影节) / 2018-10-26(西班牙) / 米洛斯拉夫·哈尼斯泽斯基 / 托马斯·兹代克 / 西班牙 / 波兰 / 比利时 / 德国 / 法国 / 匈牙利 / anotherdayoflifefilm.com/en/index.html / 劳尔·德·拉·富恩特 / 达米安·纽诺 / 85分钟 / 人生的另一天 / 传记 / 动画 / 劳尔·德·拉·富恩特 Raúl de la Fuente / Amaia Remirez / 英语 / 葡萄牙语 / 波兰语 / 西班牙语');
  assert.deepEqual(r.countries, ['西班牙', '波兰', '比利时', '德国', '法国', '匈牙利']);
  assert.deepEqual(r.directors, ['劳尔·德·拉·富恩特', '达米安·纽诺']);
  assert.deepEqual(r.genres, ['传记', '动画']);
  assert.deepEqual(r.languages, ['英语', '葡萄牙语', '波兰语', '西班牙语']);
  assert.equal(r.cast.length, 2);
});

test('电影：名字前有制表符', () => {
  const r = parseMovieIntro('2026-04-24(泰国) / 依莎亚·贺苏汪 / \t杜昂娇·琵亚乌伊 / 泰国 / 萨拉萨瓦蒂·翁索姆佩奇 / 45分钟 / 爱使圆满 / 剧情 / 爱情 / 同性 / 泰语');
  assert.deepEqual(r.cast, ['依莎亚·贺苏汪', '杜昂娇·琵亚乌伊']);
});

test('电影：空简介不报错', () => {
  const r = parseMovieIntro('');
  assert.equal(r.year, null);
  assert.deepEqual(r.genres, []);
});

test('书：带国籍、译者、价格', () => {
  const r = parseBookPub('[美] 哈珀·李 / 李育超 / 译林出版社 / 2017-2 / 58.00');
  assert.deepEqual(r.authors, ['哈珀·李']);
  assert.deepEqual(r.translators, ['李育超']);
  assert.equal(r.publisher, '译林出版社');
  assert.equal(r.year, 2017);
  assert.deepEqual(r.countries, ['美国']);
});

test('书：全角括号国籍、价格带"元"', () => {
  const r = parseBookPub('（美）戴维•纽曼 / 黄腾 / 北京大学出版社 / 2017-4 / 128.00 元');
  assert.deepEqual(r.authors, ['戴维•纽曼']);
  assert.deepEqual(r.countries, ['美国']);
  assert.equal(r.publisher, '北京大学出版社');
});

test('书：苏联、墨西哥国籍', () => {
  assert.deepEqual(parseBookPub('[苏联] 米哈伊尔·肖洛霍夫 / 力冈 / 译林出版社 / 2010-11 / 98.00元').countries, ['苏联']);
  assert.deepEqual(parseBookPub('[墨西哥] 胡安·鲁尔福 / 屠孟超 / 译林出版社 / 2021-1 / 48.00元').countries, ['墨西哥']);
});

test('书：没有价格', () => {
  const r = parseBookPub('久保田博二 / 黄天 / 三联书店香港分店 / 1987-3');
  assert.equal(r.year, 1987);
  assert.equal(r.publisher, '三联书店香港分店');
  assert.deepEqual(r.authors, ['久保田博二']);
});

test('书：外文书、外币价格、没有译者', () => {
  const r = parseBookPub('Julian Bell / Thames & Hudson / 2010-3 / GBP 18.95');
  assert.deepEqual(r.authors, ['Julian Bell']);
  assert.equal(r.publisher, 'Thames & Hudson');
  assert.equal(r.year, 2010);
});

test('书：多位作者用顿号分隔、去掉"著""编"', () => {
  const r = parseBookPub('李霖灿 著、【加】李在中 编 / 北京出版社 / 2021-3 / 98.00元');
  assert.deepEqual(r.authors, ['李霖灿', '李在中']);
  assert.deepEqual(r.countries, ['加拿大']);
  assert.equal(r.publisher, '北京出版社');
});

test('书：作者名里的英文括号被去掉', () => {
  const r = parseBookPub('[英] 贡布里希 (Sir E.H.Gombrich) / 范景中、杨成凯 / 广西美术出版社 / 2008-04 / 280.00');
  assert.deepEqual(r.authors, ['贡布里希']);
  assert.deepEqual(r.translators, ['范景中', '杨成凯']);
  assert.deepEqual(r.countries, ['英国']);
});

test('电影：时长前重复片名、导演后带具体时间、方言', () => {
  const r = parseMovieIntro('2016-10-17(意大利) / 理查德·麦登 / 达斯汀·霍夫曼 / 英国 / 意大利 / 法国 / 塞尔吉奥·米米卡-戈赞 / 美第奇家族：翡冷翠名门 / 60分钟 / 美第奇家族：翡冷翠名门 / 剧情 / 历史 / 尼古拉斯·梅耶 Nicholas Meyer / 英语');
  assert.deepEqual(r.directors, ['塞尔吉奥·米米卡-戈赞']);
  const r2 = parseMovieIntro('2024-09-15(中国大陆) / 咏梅 / 姜武 / 中国大陆 / 尹丽川 / 2024-09-06 19:50 / 106分钟 / 剧情 / 家庭 / 尹丽川 Lichuan Yin / 汉语普通话 / 河南方言 / 四川方言');
  assert.deepEqual(r2.directors, ['尹丽川']);
  assert.deepEqual(r2.languages, ['汉语普通话', '河南方言', '四川方言']);
  assert.deepEqual(r2.writers, ['尹丽川']);
});

test('电影：带地区前缀的时长、带外文的语言', () => {
  const r = parseMovieIntro('2004-02-12 / 亚历山德拉·艾迪尼 / George Houliaras / 希腊 / 法国 / 西奥·安哲罗普洛斯 / Greece: 185 分钟 / 170分钟 / 162分钟(DVD) / 哭泣的草原 / 剧情 / 历史 / 西奥·安哲罗普洛斯 Theodoros Angelopoulos / 希腊语');
  assert.deepEqual(r.directors, ['西奥·安哲罗普洛斯']);
  assert.equal(r.durationMin, 185);
  assert.deepEqual(r.genres, ['剧情', '历史']);
  assert.deepEqual(parseMovieIntro('2021-12-21(波兰) / 阿德里安娜 / 波兰 / 10分钟（单集） / 安检 / 爱情 / 短片 / Natasza Parzymies / 波兰语 Polski').languages, ['波兰语']);
  assert.deepEqual(parseMovieIntro('2021-12-21(波兰) / 阿德里安娜 / 波兰 / 8分钟 / 安检 / 爱情 / 波兰语（Polski）').languages, ['波兰语']);
});

test('电影：少见后缀的官网地址不算导演', () => {
  const r = parseMovieIntro('2019-12-25(美国) / 乔治·麦凯 / 英国 / 美国 / 1917.movie / 萨姆·门德斯 / 119分钟 / 1917 / 剧情 / 战争 / 英语');
  assert.deepEqual(r.directors, ['萨姆·门德斯']);
});

test('书：台币价格、点号和斜杠日期、六角括号国籍', () => {
  const r = parseBookPub('平庫ワカ / 杜信彰 / 東立 / 2023-4 / 新台幣 130元');
  assert.equal(r.publisher, '東立');
  assert.equal(r.year, 2023);
  const r2 = parseBookPub('〔法〕费尔南·布罗代尔、Fernand Braudel / 刘北成、周立红 / 北京大学出版社 / 2008.10 / 28.00元');
  assert.equal(r2.publisher, '北京大学出版社');
  assert.equal(r2.year, 2008);
  assert.deepEqual(r2.countries, ['法国']);
  const r3 = parseBookPub('胡少安 / 香港天地图书有限公司 / 2004/07');
  assert.equal(r3.publisher, '香港天地图书有限公司');
  assert.equal(r3.year, 2004);
  assert.deepEqual(parseBookPub('[白俄] S.A.阿列克谢耶维奇 / 吕宁思 / 九州出版社 / 2014-6 / 32.00元').countries, ['白俄罗斯']);
  assert.equal(parseBookPub('某作者 / 某出版社 / 2010-1 / 1999.00').year, 2010);
  const r4 = parseBookPub('[英] 肯·福莱特 / 陈杰 / 江苏凤凰文艺出版社 / 2017-3 / 132.00（全三册）');
  assert.equal(r4.publisher, '江苏凤凰文艺出版社');
  assert.equal(r4.year, 2017);
  assert.equal(parseBookPub('冯小刚 / 长江文艺出版社 / 2013-9 / 35.00元（有2013年10月4印本）').publisher, '长江文艺出版社');
});

test('书：没标国籍的中国作者推断为中国', () => {
  assert.deepEqual(parseBookPub('余华 / 作家出版社 / 2012-8 / 20.00元').countries, ['中国']);
  assert.deepEqual(parseBookPub('李霖灿 / 中信出版社 / 2018-7 / 88.00元').countries, ['中国']);
  assert.deepEqual(parseBookPub('东野圭吾 / 李盈春 / 南海出版公司 / 2014-5 / 39.50元').countries, []);
  assert.deepEqual(parseBookPub('约翰·斯坦贝克 / 上海译文出版社 / 2018-3').countries, []);
  assert.deepEqual(parseBookPub('平庫ワカ / 東立 / 2023-4').countries, []);
  assert.deepEqual(parseBookPub('Julian Bell / Thames & Hudson / 2010-3 / GBP 18.95').countries, []);
  assert.deepEqual(parseBookPub('[美] 哈珀·李 / 李育超 / 译林出版社 / 2017-2 / 58.00').countries, ['美国']);
});

test('书：只有两项时第二项是译者、名字后面的国籍', () => {
  const r = parseBookPub('信田佐代子 / 黄琳雅');
  assert.equal(r.publisher, null);
  assert.deepEqual(r.translators, ['黄琳雅']);
  assert.deepEqual(r.countries, []);
  const r2 = parseBookPub('[英]莫琳·拉芬斯珀格（Maureen Raffensperger） / 人民邮电出版社');
  assert.equal(r2.publisher, '人民邮电出版社');
  const r3 = parseBookPub('安妮.爱德华兹（美） / 张三 / 某出版社 / 2010-1');
  assert.deepEqual(r3.countries, ['美国']);
  assert.deepEqual(r3.authors, ['安妮.爱德华兹']);
  assert.deepEqual(parseBookPub('Reginald Fleming Johnston（庄士敦） / 秦仲龢（高伯雨） / 李敖出版社 / 1988-4').countries, []);
});

test('工具函数', () => {
  assert.deepEqual(parseMyTags('标签: 韩国 人性'), ['韩国', '人性']);
  assert.deepEqual(parseMyTags(''), []);
  assert.equal(parseRating('rating4-t'), 4);
  assert.equal(parseRating(undefined), null);
  assert.equal(parseMarkDate('2026-09-13 想读'), '2026-09-13');
  assert.equal(normPerson('张抗俊 Hang-jun Jang'), '张抗俊');
  assert.equal(normPerson('Boss Jiraboon Choeisuwan'), 'Boss Jiraboon Choeisuwan');
  assert.equal(decadeOf(2018), '2010年代');
});
