// Shared prompt presets. Used by the popup and the background script.
const PAGEHOP_PRESETS = [
  { id: 'none', label: 'Just the page', prompt: '' },
  { id: 'summary', label: 'Summarise it', prompt: 'Please summarise this page in plain British English. Start with a two sentence overview, then the key points as short bullets.' },
  { id: 'actions', label: 'Key points and actions', prompt: 'Please pull out the key points from this page, then list any actions, deadlines or decisions I should know about.' },
  { id: 'simple', label: 'Explain it simply', prompt: 'Please explain this page simply, as if to someone new to the topic. Avoid jargon and use a short example if it helps.' }
];
