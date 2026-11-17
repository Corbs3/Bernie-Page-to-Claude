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
    const parts = [];
    if (preset.prompt) parts.push(preset.prompt, '');
    parts.push('---', 'Page: ' + result.title, 'Link: ' + result.url, result.usedSelection ? '(Selected text only)' : '', '', body);
    if (trimmed) parts.push('', '[Page was very long, so Bernie trimmed the end.]');

    return { ok: true, text: parts.join('\n').replace(/\n{3,}/g, '\n\n'), prompt: preset.prompt, title: result.title, chars: body.length, trimmed };
  } catch (e) {
    return { ok: false, error: "Chrome doesn't let extensions read this page (for example, Chrome settings or the Web Store)." };
  }
}

const APP_LIMIT = 13000; // the Mac app accepts about 14,000 characters in a link

async function getOpenIn() {
  const { openIn } = await chrome.storage.sync.get({ openIn: 'browser' });
  return openIn;
}

// Returns { usedClipboard: true } when the person needs to press Cmd+V in the app.
async function openClaude(built, target, fromTabId) {
  if (target === 'copy') return { usedClipboard: true }; // person pastes into a chat they already have open
  if (target === 'app') {
    const fits = built.text.length <= APP_LIMIT;
    const q = fits ? built.text : (built.prompt ? built.prompt + '\n\n' : '');
    const url = 'claude://claude.ai/new' + (q ? '?q=' + encodeURIComponent(q) : '');
    // Handing the link to the current tab passes it to macOS without leaving the page.
    await chrome.tabs.update(fromTabId, { url });
    return { usedClipboard: !fits };
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
  if (target === 'copy') return flashBadge(tab.id, copied ? '✓' : '!', copied ? '#2E7D5B' : '#C0392B');
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
