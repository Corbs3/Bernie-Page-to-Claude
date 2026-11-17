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
      case 'strong': case 'b': { const t = kids().trim(); return t ? '**' + t + '** ' : ''; }
      case 'em': case 'i': { const t = kids().trim(); return t ? '*' + t + '* ' : ''; }
      case 'code': return '`' + node.textContent + '`';
      case 'pre': return '\n\n```\n' + node.textContent.replace(/\n+$/, '') + '\n```\n\n';
      case 'blockquote': return '\n\n' + kids().trim().split('\n').map(l => '> ' + l).join('\n') + '\n\n';
      case 'a': {
        const t = kids().trim();
        const href = node.href || '';
        if (!t) return '';
        if (!href || href.startsWith('javascript:') || href.split('#')[0] === location.href.split('#')[0]) return t + ' ';
        return '[' + t + '](' + href + ') ';
      }
      case 'img': return node.alt ? '[Image: ' + clean(node.alt).trim() + '] ' : '';
      case 'ul': case 'ol': {
        let i = 1;
        const items = Array.from(node.children).filter(c => c.tagName === 'LI').map(li => {
          const marker = tag === 'ol' ? (i++) + '. ' : '- ';
          return marker + toMd(li, ctx).trim().replace(/\n{2,}/g, '\n').replace(/\n/g, '\n  ');
        });
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
    return md.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/ {2,}/g, ' ').trim();
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

  const markdown = tidy(toMd(source, {}));
  return {
    title: document.title || location.hostname,
    url: location.href,
    markdown,
    usedSelection
  };
}
