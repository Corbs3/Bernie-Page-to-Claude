importScripts('prompts.js');

const MAX_CHARS = 200000;      // keeps very large pages manageable
const PENDING_TTL = 2 * 60 * 1000; // a hop waits up to 2 minutes for Claude to load

// ---------- Setup ----------
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'hop-page', title: 'Send this page to Claude with Bernie', contexts: ['page', 'link', 'image'] });
    chrome.contextMenus.create({ id: 'hop-selection', title: 'Send selected text to Claude with Bernie', contexts: ['selection'] });
  });
});

// ---------- Core ----------
async function getDefaultPreset() {
  const { defaultPreset } = await chrome.storage.sync.get({ defaultPreset: 'none' });
  return defaultPreset;
}

async function buildHop(tabId, mode, presetId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['extract.js'] });
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (m) => pageHopExtract(m),
      args: [mode]
    });
    if (!result || result.markdown.length < 40) {
      return { ok: false, error: "There isn't enough readable text on this page to send." };
    }
    let body = result.markdown;
    let trimmed = false;
    if (body.length > MAX_CHARS) { body = body.slice(0, MAX_CHARS); trimmed = true; }

    const preset = PAGEHOP_PRESETS.find(p => p.id === presetId) || PAGEHOP_PRESETS[0];
    const meta = { prompt: preset.prompt, title: result.title, url: result.url, usedSelection: result.usedSelection };
    const note = trimmed ? '[Page was very long, so Bernie trimmed the end.]' : '';

    return { ok: true, text: compose(meta, body, note), meta, body, title: result.title, chars: body.length, trimmed };
  } catch (e) {
    return { ok: false, error: "Chrome doesn't let extensions read this page (for example, Chrome settings or the Web Store)." };
  }
}

// Links get longer once encoded (a space becomes %20), so we measure the encoded link.
// Kept well under the app's limit so Chrome and macOS reliably pass it on.
const APP_URL_LIMIT = 14000;

async function getOpenIn() {
  const { openIn } = await chrome.storage.sync.get({ openIn: 'browser' });
  return openIn;
}

// Returns { usedClipboard: true } when the person needs to press Cmd+V in the app.
// Puts the prompt, page details and page text together.
function compose(meta, body, note) {
  const parts = [];
  if (meta.prompt) parts.push(meta.prompt, '');
  parts.push('---', 'Page: ' + meta.title, 'Link: ' + meta.url, meta.usedSelection ? '(Selected text only)' : '', '', body);
  if (note) parts.push('', note);
  return parts.join('\n').replace(/\n{3,}/g, '\n\n');
}

// Slimmer text for the Mac app: keep link words, drop the long web addresses.
function slim(body) {
  return body.replace(/\[([^\]]+)\]\((?:https?|mailto):[^)\s]*\)/g, '$1').replace(/[ \t]{2,}/g, ' ');
}

// Builds the longest text that still fits in an app link, cut at a word.
function fitForApp(built) {
  const body = slim(built.body);
  const whole = compose(built.meta, body, '');
  if (encodeURIComponent(whole).length <= APP_URL_LIMIT) return { text: whole, cut: false };
  const note = '[Bernie trimmed this page to fit the Claude app. Use Browser or Paste myself for the full page.]';
  let lo = 0, hi = body.length;
  while (lo < hi) {               // binary search for the longest part that fits
    const mid = Math.ceil((lo + hi) / 2);
    if (encodeURIComponent(compose(built.meta, body.slice(0, mid) + ' …', note)).length <= APP_URL_LIMIT) lo = mid; else hi = mid - 1;
  }
  let part = body.slice(0, lo);
  const lastSpace = part.lastIndexOf(' ');
  if (lastSpace > lo * 0.8) part = part.slice(0, lastSpace);
  return { text: compose(built.meta, part + ' …', note), cut: true };
}

async function openClaude(built, target, fromTabId) {
  if (target === 'copy') {
    await showToast(fromTabId, 'Bernie has copied this page. Go to your Claude chat and press ⌘V.');
    return { usedClipboard: true };
  }
  if (target === 'app') {
    const fitted = fitForApp(built);
    const url = 'claude://claude.ai/new?q=' + encodeURIComponent(fitted.text);
    if (fitted.cut) {
      await showToast(fromTabId, 'This page was long, so Bernie sent the first part. The full page is copied too, if you need it.');
    }
    // Handing the link to the current tab passes it to macOS without leaving the page.
    await chrome.tabs.update(fromTabId, { url });
    return { usedClipboard: false };
  }
  const tab = await chrome.tabs.create({ url: 'https://claude.ai/new' });
  await chrome.storage.session.set({ pendingHop: { text: built.text, tabId: tab.id, at: Date.now() } });
  return { usedClipboard: false };
}

// Best effort copy, used when the hop starts from the right-click menu or shortcut.
async function copyInTab(tabId, text) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (t) => {
        try { await navigator.clipboard.writeText(t); return true; } catch (e) {
          const area = document.createElement('textarea');
          area.value = t; area.style.position = 'fixed'; area.style.opacity = '0';
          document.body.appendChild(area); area.select();
          const ok = document.execCommand('copy'); area.remove(); return ok;
        }
      },
      args: [text]
    });
    return !!result;
  } catch (e) { return false; }
}

// Friendly message shown on the page itself, so it works from the popup, right-click and shortcut.
async function showToast(tabId, message) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (msg, icon) => {
        document.getElementById('bernie-toast')?.remove();
        const host = document.createElement('div');
        host.id = 'bernie-toast';
        const root = host.attachShadow({ mode: 'open' });
        root.innerHTML = `
          <style>
            .t { position: fixed; z-index: 2147483647; top: 20px; right: 20px; max-width: 360px;
                 display: flex; gap: 12px; align-items: center; padding: 12px 14px; border-radius: 14px;
                 font: 14px/1.45 ui-rounded, "SF Pro Rounded", system-ui, sans-serif;
                 background: #2B4C7E; color: #F6F8FB; border-bottom: 4px solid #C8372D;
                 box-shadow: 0 8px 28px rgba(20,35,60,.35); }
            img { width: 40px; height: 40px; flex: none; }
            button { font: inherit; background: none; border: 0; color: #C9D6EA; cursor: pointer; padding: 2px 6px; }
            button:focus-visible { outline: 3px solid #F5C542; border-radius: 6px; }
          </style>
          <div class="t" role="status"><img alt="" src="${icon}"><span></span><button aria-label="Close">✕</button></div>`;
        root.querySelector('span').textContent = msg;
        root.querySelector('button').addEventListener('click', () => host.remove());
        document.documentElement.appendChild(host);
        setTimeout(() => host.remove(), 9000);
      },
      args: [message, chrome.runtime.getURL('icons/icon48.png')]
    });
  } catch (e) { /* some pages can't show messages; the copy still worked */ }
}

function flashBadge(tabId, text, colour) {
  chrome.action.setBadgeBackgroundColor({ color: colour });
  chrome.action.setBadgeText({ text, tabId });
  setTimeout(() => chrome.action.setBadgeText({ text: '', tabId }), 3000);
}

async function quickHop(tab, mode) {
  const built = await buildHop(tab.id, mode, await getDefaultPreset());
  if (!built.ok) return flashBadge(tab.id, '!', '#C0392B');
  const copied = await copyInTab(tab.id, built.text);
  const target = await getOpenIn();
  if (target === 'copy') {
    if (!copied) return flashBadge(tab.id, '!', '#C0392B');
    flashBadge(tab.id, '✓', '#2E7D5B');
  }
  await openClaude(built, target, tab.id);
}

// ---------- Triggers ----------
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab) return;
  quickHop(tab, info.menuItemId === 'hop-selection' ? 'selection' : 'page');
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'hop-page' || !tab) return;
  quickHop(tab, 'auto');
});

// ---------- Messages from popup and Claude tab ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.type === 'build') {
      sendResponse(await buildHop(msg.tabId, msg.mode, msg.preset));
    } else if (msg.type === 'open') {
      sendResponse(await openClaude(msg.built, msg.target, msg.tabId));
    } else if (msg.type === 'getPending') {
      const { pendingHop } = await chrome.storage.session.get('pendingHop');
      const fresh = pendingHop && Date.now() - pendingHop.at < PENDING_TTL;
      if (fresh && sender.tab && pendingHop.tabId === sender.tab.id) {
        await chrome.storage.session.remove('pendingHop');
        sendResponse({ text: pendingHop.text });
      } else {
        sendResponse({ text: null });
      }
    }
  })();
  return true; // keep the message channel open for the async reply
});
