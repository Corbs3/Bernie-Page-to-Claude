// Runs on claude.ai. If Bernie just opened this tab, it pastes the page into the message box.
(async function () {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // Ask the background for a waiting hop (retry briefly in case we loaded first).
  let text = null;
  for (let i = 0; i < 6 && !text; i++) {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'getPending' });
      text = res && res.text;
    } catch (e) { return; }
    if (!text) await sleep(400);
  }
  if (!text) return;

  // Wait for Claude's message box to appear.
  let box = null;
  for (let i = 0; i < 60 && !box; i++) {
    box = document.querySelector('div[contenteditable="true"].ProseMirror') ||
          document.querySelector('[contenteditable="true"]');
    if (!box) await sleep(250);
  }
  if (!box) return showBanner(text, false);

  box.focus();
  let handled = false;
  try {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    const evt = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
    box.dispatchEvent(evt);
    handled = evt.defaultPrevented;
  } catch (e) { /* fall through */ }

  if (!handled) {
    try { handled = document.execCommand('insertText', false, text); } catch (e) { /* fall through */ }
  }
  showBanner(text, handled);

  // ---------- Small on-page message ----------
  function showBanner(t, success) {
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        .b { position: fixed; z-index: 2147483647; bottom: 24px; left: 50%; transform: translateX(-50%);
             display: flex; gap: 12px; align-items: center; padding: 12px 16px; border-radius: 14px;
             font: 14px/1.4 ui-rounded, "SF Pro Rounded", system-ui, sans-serif;
             background: #2B4C7E; color: #F6F8FB; box-shadow: 0 6px 24px rgba(20,35,60,.35); max-width: 90vw; }
        .f { font-size: 22px; }
        button { font: inherit; font-weight: 600; border: 0; border-radius: 10px; padding: 7px 12px; cursor: pointer;
                 background: #F6F8FB; color: #2B4C7E; }
        button:focus-visible { outline: 3px solid #F5C542; outline-offset: 2px; }
        .x { background: transparent; color: #C9D6EA; padding: 4px 8px; }
      </style>
      <div class="b" role="status">
        <span class="f" aria-hidden="true">🐶</span>
        <span class="m"></span>
        <button class="copy" hidden>Copy page text</button>
        <button class="x" aria-label="Close">✕</button>
      </div>`;
    const msg = shadow.querySelector('.m');
    const copy = shadow.querySelector('.copy');
    if (success) {
      msg.textContent = "Bernie's delivered the page. Add your question, check it, then press Enter.";
    } else {
      msg.textContent = "Bernie couldn't paste automatically. Copy the text, then press ⌘V in the message box.";
      copy.hidden = false;
      copy.addEventListener('click', async () => {
        await navigator.clipboard.writeText(t);
        copy.textContent = 'Copied';
      });
    }
    shadow.querySelector('.x').addEventListener('click', () => host.remove());
    document.body.appendChild(host);
    if (success) setTimeout(() => host.remove(), 6000);
  }
})();
