// Runs inside the web page. Must stay self-contained (no outside variables).
function pageHopExtract(mode) {
  const SKIP = 'script,style,noscript,svg,canvas,iframe,video,audio,form,button,input,select,textarea,[aria-hidden="true"],[hidden]';
  const CHROME = 'nav,footer,header,aside,[role="navigation"],[role="banner"],[role="contentinfo"],[role="complementary"]';

  function pickRoot() {
    const candidates = [document.querySelector('article'), document.querySelector('main'), document.querySelector('[role="main"]')];
    for (const c of candidates) {
      if (c && c.innerText && c.innerText.trim().length > 400) return { el: c, isBody: false };
    }
    return { el: document.body, isBody: true };
  }

  function clean(text) { return text.replace(/\s+/g, ' '); }

  function decode(text) {
    const area = document.createElement('textarea');
    area.innerHTML = text;
    return area.value;
  }

  function stripTracking(href) {
    try {
      const u = new URL(href);
      [...u.searchParams.keys()].forEach(k => { if (/^(utm_|fbclid|gclid|mc_|ref$)/i.test(k)) u.searchParams.delete(k); });
      return u.toString();
    } catch (e) { return href; }
  }

  function toMd(node, ctx) {
    if (node.nodeType === Node.TEXT_NODE) return clean(node.textContent);
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const tag = node.tagName.toLowerCase();
    const kids = () => Array.from(node.childNodes).map(n => toMd(n, ctx)).join('');
    switch (tag) {
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
        const t = kids().trim();
        return t ? '\n\n' + '#'.repeat(+tag[1]) + ' ' + t + '\n\n' : '';
      }
      case 'p': case 'section': case 'div': case 'figure': case 'figcaption': {
        const t = kids().trim();
        return t ? '\n\n' + t + '\n\n' : '';
      }
      case 'br': return '\n';
      case 'hr': return '\n\n---\n\n';
      case 'strong': case 'b': { const t = kids().trim(); return !t ? '' : /^\*\*.*\*\*$/.test(t) ? t + ' ' : '**' + t + '** '; }
      case 'em': case 'i': { const t = kids().trim(); return t ? '*' + t + '* ' : ''; }
      case 'code': return '`' + node.textContent + '`';
      case 'pre': return '\n\n```\n' + node.textContent.replace(/\n+$/, '') + '\n```\n\n';
      case 'blockquote': return '\n\n' + kids().trim().split('\n').map(l => '> ' + l).join('\n') + '\n\n';
      case 'a': {
        const t = kids().replace(/(^|\n)\s*#+\s*/g, ' ').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
        const href = node.href || '';
        if (!t) return '';
        if (!href || href.startsWith('javascript:') || href.split('#')[0] === location.href.split('#')[0]) return t + ' ';
        return '[' + t + '](' + stripTracking(href) + ') ';
      }
      case 'img': {
        if (node.closest('a') || !node.alt) return '';
        const alt = clean(decode(node.alt)).trim();
        return alt ? '[Image: ' + alt + '] ' : '';
      }
      case 'ul': case 'ol': {
        let i = 1;
        const items = Array.from(node.children).filter(c => c.tagName === 'LI')
          .map(li => toMd(li, ctx).trim()).filter(Boolean).map(text => {
            const marker = tag === 'ol' ? (i++) + '. ' : '- ';
            return marker + text.replace(/\n{2,}/g, '\n').replace(/\n/g, '\n  ');
          });
        if (!items.length) return '';
        return '\n\n' + items.join('\n') + '\n\n';
      }
      case 'table': {
        const rows = Array.from(node.querySelectorAll('tr')).map(tr =>
          Array.from(tr.children).map(td => clean(td.innerText || '').trim().replace(/\|/g, '/')));
        if (!rows.length) return '';
        const width = Math.max(...rows.map(r => r.length));
        const line = r => '| ' + Array.from({ length: width }, (_, k) => r[k] || '').join(' | ') + ' |';
        return '\n\n' + [line(rows[0]), '|' + ' --- |'.repeat(width), ...rows.slice(1).map(line)].join('\n') + '\n\n';
      }
      default: return kids();
    }
  }

  function tidy(md) {
    md = md.replace(/\*{3,}/g, '**').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/ {2,}/g, ' ');
    // Remove repeats (slideshows and "featured" boxes often show the same item twice).
    // A repeated headline is kept when the text under it is new, so descriptions keep their titles.
    const lines = md.split('\n');
    const key = (line) => line.replace(/^[\s>#*\-\d.]+/, '').replace(/\[|\]\([^)]*\)/g, '').replace(/\W+/g, ' ').trim().toLowerCase();
    const keys = lines.map(key);
    const isHeading = (line) => /^\s*(-\s*)?#+\s/.test(line);
    const symbolsOnly = (line) => line.trim() !== '---' && /^\s*(-\s*)?[^\p{L}\p{N}\s]{1,3}\s*$/u.test(line);
    const seen = new Set();
    const out = [];
    lines.forEach((line, i) => {
      const k = keys[i];
      if (symbolsOnly(line)) return;                       // stray "×" close buttons and similar
      const heading = isHeading(line);
      if (k.length < (heading ? 10 : 25)) {                 // short lines
        if (k.length >= 10 && seen.has(k) && !heading) return; // short repeat, e.g. the site name twice
        if (k.length >= 10) seen.add(k);
        out.push(line);
        return;
      }
      if (seen.has(k)) {
        if (heading) {
          let j = i + 1;
          while (j < lines.length && !keys[j]) j++;
          if (j < lines.length && keys[j].length >= 25 && !seen.has(keys[j])) out.push(line);
        }
        return;
      }
      seen.add(k);
      out.push(line);
    });
    return out.join('\n').replace(/^\s*[-*]\s*$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  }

  let source;
  let usedSelection = false;
  const sel = window.getSelection();
  if ((mode === 'selection' || mode === 'auto') && sel && sel.rangeCount && sel.toString().trim()) {
    source = document.createElement('div');
    for (let r = 0; r < sel.rangeCount; r++) source.appendChild(sel.getRangeAt(r).cloneContents());
    usedSelection = true;
  } else {
    const root = pickRoot();
    source = root.el.cloneNode(true);
    if (root.isBody) source.querySelectorAll(CHROME).forEach(n => n.remove());
  }
  source.querySelectorAll(SKIP).forEach(n => n.remove());

  // Remove clutter: cookie banners, pop-ups, sign-ups, share bars, related links.
  // Safety check: never remove anything holding most of the page's text.
  const CLUTTER = /^(menu|menus|nav|navbar|navigation|site-header|site-footer|footer|sidebar|megamenu|mega-menu|dropdown|drawer|offcanvas|off-canvas|skip|skip-link|toolbar|cookies?|consent|gdpr|onetrust|didomi|cmp|popup|modal|overlay|newsletter|subscribe|signup|sign-up|share|sharing|social|related|recommended|recommendations|read-more|more-stories|promo|advert|adverts|ads?|sponsored|outbrain|taboola|comments?|breadcrumbs?)([-_].*)?$|([-_])(cookies?|consent|gdpr|newsletter|subscribe|share|sharing|social|related|recommended|promo|advert|ads?|sponsored|comments?|menu|nav|navigation|footer|sidebar|dropdown)$/i;
  const totalText = (source.textContent || '').length || 1;
  const isClutter = (el) => {
    if (el.matches('[role="dialog"],[role="alertdialog"],[aria-modal="true"],dialog')) return true;
    const tokens = ((el.getAttribute('class') || '') + ' ' + (el.id || '')).split(/\s+/).filter(Boolean);
    return tokens.some(t => CLUTTER.test(t));
  };
  Array.from(source.querySelectorAll('*')).forEach(el => {
    if (!source.contains(el)) return; // already removed with a parent
    if (isClutter(el) && (el.textContent || '').length < totalText * 0.4) el.remove();
  });

  // Menus: lists where nearly every item is a short link ("Home", "Shop", "Video").
  source.querySelectorAll('ul, ol').forEach(list => {
    if (!source.contains(list)) return;
    const items = Array.from(list.children).filter(li => li.tagName === 'LI');
    const filled = items.filter(li => li.textContent.trim());
    if (items.length >= 3 && filled.length === 0) return list.remove();
    if (filled.length < 3) return;
    const shortLinks = filled.filter(li => li.querySelector('a') && li.textContent.trim().length <= 30);
    if (shortLinks.length / filled.length >= 0.8) list.remove();
  });
  source.querySelectorAll('a').forEach(a => {
    if (/^\s*skip to/i.test(a.textContent)) a.remove();
  });

  // Sign-up pop-ups: small boxes with a heading like "Join our mailing list".
  const SIGNUP = /(mailing list|newsletter|sign ?up|subscribe|join our)/i;
  source.querySelectorAll('div, section, aside, form').forEach(box => {
    if (!source.contains(box)) return;
    const text = box.textContent.trim();
    if (text.length > 300) return;
    const heading = box.querySelector('h1, h2, h3, h4, h5, h6, strong');
    if (heading && SIGNUP.test(heading.textContent)) box.remove();
  });

  const markdown = tidy(toMd(source, {}));
  return {
    title: document.title || location.hostname,
    url: location.href,
    markdown,
    usedSelection
  };
}
