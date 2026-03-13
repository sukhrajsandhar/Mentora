// ── export.js ─────────────────────────────────────────────────────────────────
// Chat export: PDF (print), PNG (screenshot), Markdown

// ── Plain text / markdown stripper (shared with copy) ────────────────────────
function toPlainText(md) {
  return md
    .replace(/<details>[\s\S]*?<\/details>/gi, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`{3}[\s\S]*?`{3}/g, '')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\$\$(.+?)\$\$/gs, '$1')
    .replace(/\$(.+?)\$/g, '$1')
    .replace(/^[-*]\s+/gm, '• ')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/^---+$/gm, '')
    .replace(/💡\s*/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── Collect all messages from the DOM ────────────────────────────────────────
function collectMessages() {
  const msgs = [];
  document.querySelectorAll('#messages .msg').forEach(el => {
    if (el.classList.contains('sys')) return;
    const label = el.querySelector('.msg-label')?.childNodes[0]?.textContent?.trim() || '';
    const time  = el.querySelector('.msg-time')?.textContent?.trim() || '';
    const bubble = el.querySelector('.msg-bubble');
    if (!bubble) return;
    const role = el.classList.contains('user') ? 'user' : 'ai';
    // Get inner text for clean content
    const text = bubble.innerText || bubble.textContent || '';
    msgs.push({ role, label, time, text: text.trim() });
  });
  return msgs;
}

// ── Export as Markdown ────────────────────────────────────────────────────────
export function exportMarkdown() {
  const msgs = collectMessages();
  if (!msgs.length) { alert('Nothing to export yet.'); return; }

  const date = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  let md = `# Whiteboard Co-Pilot Session\n_${date}_\n\n---\n\n`;

  msgs.forEach(m => {
    const who = m.role === 'user' ? `**You** (${m.time})` : `**${m.label}** (${m.time})`;
    md += `${who}\n\n${m.text}\n\n---\n\n`;
  });

  const blob = new Blob([md], { type: 'text/markdown' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `session-${Date.now()}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Export as PDF (print dialog) ─────────────────────────────────────────────
export function exportPDF() {
  const msgs = collectMessages();
  if (!msgs.length) { alert('Nothing to export yet.'); return; }

  const date = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  // Build a minimal self-contained print HTML
  const rows = msgs.map(m => {
    const who   = m.role === 'user' ? 'You' : m.label;
    const align = m.role === 'user' ? 'right' : 'left';
    const bg    = m.role === 'user' ? '#1e293b' : '#0f172a';
    const border= m.role === 'user' ? 'none' : '1px solid #334155';
    return `
      <div style="margin-bottom:18px; text-align:${align}">
        <div style="font-size:9px;letter-spacing:1px;text-transform:uppercase;
                    color:#94a3b8;margin-bottom:4px;padding:0 4px">
          ${who} · ${m.time}
        </div>
        <div style="display:inline-block;max-width:85%;text-align:left;
                    background:${bg};border:${border};border-radius:8px;
                    padding:14px 18px;font-size:13px;line-height:1.8;color:#e2e8f0;
                    white-space:pre-wrap;word-break:break-word;">
          ${m.text}
        </div>
      </div>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <title>Whiteboard Co-Pilot — ${date}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #020817; color: #e2e8f0;
      padding: 32px; max-width: 800px; margin: 0 auto;
    }
    h1 { font-size: 18px; color: #f8fafc; margin-bottom: 4px; }
    .meta { font-size: 11px; color: #64748b; margin-bottom: 28px; }
    @media print {
      body { background: white; color: #111; padding: 20px; }
      h1 { color: #111; }
    }
  </style>
</head>
<body>
  <h1>Whiteboard Co-Pilot</h1>
  <p class="meta">Session exported ${date}</p>
  ${rows}
</body>
</html>`;

  const win = window.open('', '_blank');
  win.document.write(html);
  win.document.close();
  win.onload = () => { win.focus(); win.print(); };
}

// ── Export as PNG screenshot (dom-to-image-more) ─────────────────────────────
export async function exportScreenshot() {
  const msgEl = document.getElementById('messages');
  if (!msgEl || !document.querySelector('#messages .msg')) {
    alert('Nothing to export yet.'); return;
  }

  if (!window.domtoimage) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/dom-to-image-more/3.4.0/dom-to-image-more.min.js';
      s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const bg = isDark ? '#09090b' : '#f8fafc';

  // Measure the actual content bounding box
  const msgs = msgEl.querySelectorAll('.msg');
  if (!msgs.length) return;
  const first = msgs[0].getBoundingClientRect();
  const last  = msgs[msgs.length - 1].getBoundingClientRect();
  const containerRect = msgEl.getBoundingClientRect();
  const pad = 24;
  const contentHeight = (last.bottom - first.top) + pad * 2;
  const contentWidth  = containerRect.width;

  // Temporarily expand container
  const prevOverflow   = msgEl.style.overflow;
  const prevHeight     = msgEl.style.height;
  const prevMaxHeight  = msgEl.style.maxHeight;
  const prevScrollTop  = msgEl.scrollTop;
  msgEl.scrollTop      = 0;
  msgEl.style.overflow  = 'visible';
  msgEl.style.height    = contentHeight + 'px';
  msgEl.style.maxHeight = 'none';

  try {
    const dataUrl = await window.domtoimage.toPng(msgEl, {
      bgcolor: bg,
      width:   contentWidth,
      height:  contentHeight,
    });
    const a    = document.createElement('a');
    a.href     = dataUrl;
    a.download = `session-${Date.now()}.png`;
    a.click();
  } catch (e) {
    alert('Screenshot failed: ' + e.message);
  } finally {
    msgEl.style.overflow  = prevOverflow;
    msgEl.style.height    = prevHeight;
    msgEl.style.maxHeight = prevMaxHeight;
    msgEl.scrollTop       = prevScrollTop;
  }
}

// ── Attach export dropdown next to a message's copy button ───────────────────
export function attachExportBtn(el) {
  let row = el.querySelector('.msg-top-right');
  if (!row) {
    row = document.createElement('div');
    row.className = 'msg-top-right';
    const existingCopy = el.querySelector('.copy-btn');
    if (existingCopy) { el.removeChild(existingCopy); row.appendChild(existingCopy); }
    el.appendChild(row);
  }

  // Separator
  const sep = document.createElement('span');
  sep.className = 'btn-sep';
  sep.textContent = '|';
  row.appendChild(sep);

  const wrap = document.createElement('div');
  wrap.className = 'export-wrap';

  const btn = document.createElement('button');
  btn.className = 'export-btn';
  btn.title = 'Export this message';
  btn.textContent = 'Export';

  const menu = document.createElement('div');
  menu.className = 'export-menu';
  menu.innerHTML = `
    <button class="export-item">PDF</button>
    <button class="export-item">Screenshot</button>`;

  wrap.appendChild(btn);
  wrap.appendChild(menu);
  row.appendChild(wrap);

  btn.addEventListener('click', e => {
    e.stopPropagation();
    document.querySelectorAll('.export-menu.open').forEach(m => m.classList.remove('open'));
    menu.classList.toggle('open');
  });

  document.addEventListener('click', () => menu.classList.remove('open'));

  const [pdfBtn, pngBtn] = menu.querySelectorAll('.export-item');
  pdfBtn.addEventListener('click', () => { menu.classList.remove('open'); exportMsgPDF(el); });
  pngBtn.addEventListener('click', () => { menu.classList.remove('open'); exportMsgScreenshot(el); });
}

// ── Per-message exports ───────────────────────────────────────────────────────
function exportMsgMarkdown(el) {
  const label = el.querySelector('.msg-label')?.childNodes[0]?.textContent?.trim() || 'AI';
  const time  = el.querySelector('.msg-time')?.textContent?.trim() || '';
  const text  = el.querySelector('.msg-bubble')?.innerText?.trim() || '';
  const date  = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const md    = `# ${label} — ${date}\n_${time}_\n\n---\n\n${text}\n`;
  const blob  = new Blob([md], { type: 'text/markdown' });
  const a     = document.createElement('a');
  a.href      = URL.createObjectURL(blob);
  a.download  = `message-${Date.now()}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportMsgPDF(el) {
  const label = el.querySelector('.msg-label')?.childNodes[0]?.textContent?.trim() || 'AI';
  const time  = el.querySelector('.msg-time')?.textContent?.trim() || '';
  const text  = el.querySelector('.msg-bubble')?.innerHTML || '';
  const date  = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/>
<title>${label} — ${date}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         background: #020817; color: #e2e8f0; padding: 40px; max-width: 760px; margin: 0 auto; }
  .meta { font-size: 11px; color: #64748b; margin-bottom: 24px; letter-spacing: 1px; text-transform: uppercase; }
  .bubble { font-size: 15px; line-height: 1.85; }
  h2 { font-size: 13px; font-weight: 600; border-bottom: 1px solid #334155; padding-bottom: 6px; margin: 20px 0 10px; }
  h3 { font-size: 13px; font-weight: 600; color: #94a3b8; margin: 16px 0 6px; }
  p  { margin-bottom: 10px; }
  strong { font-weight: 600; }
  @media print { body { background: white; color: #111; } }
</style></head>
<body>
  <p class="meta">${label} · ${time} · ${date}</p>
  <div class="bubble">${text}</div>
</body></html>`;

  const win = window.open('', '_blank');
  win.document.write(html);
  win.document.close();
  win.onload = () => { win.focus(); win.print(); };
}

async function exportMsgScreenshot(el) {
  if (!window.domtoimage) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/dom-to-image-more/3.4.0/dom-to-image-more.min.js';
      s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const bg = isDark ? '#09090b' : '#f8fafc';

  try {
    const dataUrl = await window.domtoimage.toPng(el, {
      bgcolor: bg,
      style: { margin: '0' },
    });
    const a    = document.createElement('a');
    a.href     = dataUrl;
    a.download = `message-${Date.now()}.png`;
    a.click();
  } catch (e) {
    alert('Screenshot failed: ' + e.message);
  }
}