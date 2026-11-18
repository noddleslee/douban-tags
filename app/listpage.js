// 把一页豆瓣列表（HTML）解析成条目数组。需要浏览器的 DOMParser。
import {
  parseMovieIntro, parseBookPub, parseMyTags, parseRating, parseMarkDate, decadeOf,
} from './parser.js';

const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

function subjectId(href) {
  const m = String(href || '').match(/subject\/(\d+)/);
  return m ? m[1] : null;
}

function base(type, status, id, extra) {
  return {
    key: `${type}:${id}`, id, type, status,
    title: '', titleFull: '', url: `https://${type}.douban.com/subject/${id}/`, cover: '',
    markDate: null, rating: null, myTags: [], comment: '',
    year: null, decade: null, countries: [], languages: [], genres: [], durationMin: null,
    cast: [], directors: [], writers: [], authors: [], translators: [], publisher: null,
    raw: '', ...extra,
  };
}

function parseMovieItem(el, status) {
  const a = el.querySelector('.title a');
  const id = subjectId(a && a.getAttribute('href'));
  if (!id) return null;
  const titleFull = text(el.querySelector('.title em')) || text(a);
  const raw = text(el.querySelector('.intro'));
  const info = parseMovieIntro(raw);
  return base('movie', status, id, {
    title: titleFull.split(' / ')[0],
    titleFull,
    cover: el.querySelector('img')?.getAttribute('src') || '',
    markDate: parseMarkDate(text(el.querySelector('.date'))),
    rating: parseRating(el.querySelector('[class^="rating"]')?.className),
    myTags: parseMyTags(text(el.querySelector('.tags'))),
    comment: text(el.querySelector('.comment')),
    raw,
    ...info,
    decade: decadeOf(info.year),
  });
}

function parseBookItem(el, status) {
  const a = el.querySelector('h2 a');
  const id = subjectId(a && a.getAttribute('href'));
  if (!id) return null;
  const titleFull = (a.getAttribute('title') || text(a)).trim();
  const raw = text(el.querySelector('.pub'));
  const info = parseBookPub(raw);
  return base('book', status, id, {
    title: titleFull.split(/[:：]/)[0].trim() || titleFull,
    titleFull,
    cover: el.querySelector('img')?.getAttribute('src') || '',
    markDate: parseMarkDate(text(el.querySelector('.short-note .date'))),
    rating: parseRating(el.querySelector('.short-note [class^="rating"]')?.className),
    myTags: parseMyTags(text(el.querySelector('.tags'))),
    comment: text(el.querySelector('.comment')),
    raw,
    ...info,
    decade: decadeOf(info.year),
  });
}

// 用已存的原始简介重新拆标签（解析规则更新后用，不需要重新访问豆瓣）
export function reparseItem(it) {
  if (!it || !it.raw) return it;
  const info = it.type === 'movie' ? parseMovieIntro(it.raw) : parseBookPub(it.raw);
  return { ...it, ...info, decade: decadeOf(info.year) };
}

export function parseListPage(html, type, status) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const nodes = type === 'movie'
    ? doc.querySelectorAll('.grid-view .item, .list-view .item')
    : doc.querySelectorAll('li.subject-item');
  const items = [];
  for (const el of nodes) {
    try {
      const it = type === 'movie' ? parseMovieItem(el, status) : parseBookItem(el, status);
      if (it) items.push(it);
    } catch (e) {
      console.warn('[douban-tags] 跳过一条解析失败的条目', e);
    }
  }
  const numText = text(doc.querySelector('.subject-num'));
  const m = numText.match(/\/\s*(\d+)/);
  return {
    items,
    total: m ? Number(m[1]) : null,
    hasNext: !!doc.querySelector('.paginator .next a'),
    isListPage: !!doc.querySelector('.subject-num, .paginator, .grid-view, .interest-list, #content'),
  };
}
