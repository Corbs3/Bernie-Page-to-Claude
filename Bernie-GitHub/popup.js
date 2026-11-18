const $ = (s) => document.querySelector(s);
const statusEl = $('#status');
let tabId = null;

function setStatus(text, isError) {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', !!isError);
}

function currentTarget() {
  return document.querySelector('input[name="openIn"]:checked').value;
}

function updateButton() {
  $('#hop').textContent = currentTarget() === 'copy' ? 'Copy for pasting' : 'Send to Claude';
  setStatus('');
}

async function init() {
  // Draw the prompt choices
  const { defaultPreset, openIn } = await chrome.storage.sync.get({ defaultPreset: 'none', openIn: 'browser' });
  document.querySelector(`input[name="openIn"][value="${openIn}"]`).checked = true;
  document.querySelectorAll('input[name="openIn"]').forEach(r =>
    r.addEventListener('change', () => { chrome.storage.sync.set({ openIn: r.value }); updateButton(); }));
  updateButton();
  const box = $('#presets');
  PAGEHOP_PRESETS.forEach(p => {
    const label = document.createElement('label');
    label.innerHTML = `<input type="radio" name="preset" value="${p.id}"><span></span>`;
    label.querySelector('span').textContent = p.label;
    if (p.id === defaultPreset) label.querySelector('input').checked = true;
    box.appendChild(label);
  });
  if (!box.querySelector('input:checked')) box.querySelector('input').checked = true;

  // Work out the current page and whether text is selected
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab.id;
  $('#page-title').textContent = tab.title || 'This page';
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => (window.getSelection() || '').toString().trim().length
    });
    if (result > 0) $('#sel-option').checked = true;
    else $('#sel-option').disabled = true;
  } catch (e) {
    $('#sel-option').disabled = true;
    $('#hop').disabled = true;
    setStatus("Chrome doesn't let extensions read this page.", true);
  }
}

async function build() {
  const mode = document.querySelector('input[name="mode"]:checked').value;
  const preset = document.querySelector('input[name="preset"]:checked').value;
  chrome.storage.sync.set({ defaultPreset: preset }); // right-click and shortcut use the last choice
  return chrome.runtime.sendMessage({ type: 'build', tabId, mode, preset });
}

$('#hop').addEventListener('click', async () => {
  $('#hop').disabled = true;
  document.body.classList.add('fetching');
  setStatus("Bernie's fetching the page…");
  const res = await build();
  if (!res.ok) { $('#hop').disabled = false; return setStatus(res.error, true); }
  let copied = true;
  try { await navigator.clipboard.writeText(res.text); } catch (e) { copied = false; }
  const target = currentTarget();
  if (target === 'copy') {
    $('#hop').disabled = false;
    setTimeout(() => document.body.classList.remove('fetching'), 600);
    if (!copied) return setStatus("Couldn't copy. Try clicking the button again.", true);
    return setStatus(res.trimmed
      ? 'Copied (very long page, so the end was trimmed). Press ⌘V in your Claude chat.'
      : 'Copied. Go to your Claude chat and press ⌘V.');
  }
  const opened = await chrome.runtime.sendMessage({ type: 'open', built: res, target, tabId });
  window.close(); // a message on the page explains any ⌘V step
});


init();
