/* =====================================================================
   SEQUEL 26 — pass rendering
   Draws the pass onto a canvas, then exports it as PNG or PDF.
   The PDF is built by hand (a single JPEG wrapped in a minimal PDF) so
   there is no CDN dependency — this keeps working on flaky campus wifi.
   ===================================================================== */

const PASS_W = 1080, PASS_H = 1500;

/* deterministic confetti so a person's pass always looks identical */
function seededRandom(seed){
  let s = 0;
  for (let i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) >>> 0;
  return function(){ s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function roundRect(ctx, x, y, w, h, r){
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
}

/**
 * data = { name, code, batch, roll, event, date, venue, amount, serial }
 */
function drawPass(ctx, data){
  const W = PASS_W, H = PASS_H;

  /* ---- background ---- */
  const bg = ctx.createLinearGradient(0, 0, W * .6, H);
  bg.addColorStop(0,   '#2B1740');
  bg.addColorStop(.55, '#1A0C26');
  bg.addColorStop(1,   '#100617');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  /* glow behind the title */
  const glow = ctx.createRadialGradient(W * .78, 150, 0, W * .78, 150, 620);
  glow.addColorStop(0, 'rgba(255,194,75,.22)');
  glow.addColorStop(1, 'rgba(255,194,75,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, 470);

  /* ---- confetti ---- */
  const rnd = seededRandom(data.code + data.name);
  const cols = ['#FFC24B', '#FF2E7E', '#6ED6E0', '#F7F0E6', '#B57BFF'];
  for (let i = 0; i < 54; i++){
    const x = rnd() * W, y = rnd() * 452, w = 8 + rnd() * 20, h = 5 + rnd() * 13;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rnd() * Math.PI);
    ctx.globalAlpha = .18 + rnd() * .5;
    ctx.fillStyle = cols[(rnd() * cols.length) | 0];
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  const PAD = 84;

  /* ---- header ---- */
  ctx.textBaseline = 'alphabetic';
  ctx.font = '500 26px "DM Mono", monospace';
  ctx.fillStyle = '#BCA9C6';
  ctx.letterSpacing = '5px';
  ctx.fillText('ENTRY PASS', PAD, 130);
  ctx.letterSpacing = '0px';

  ctx.font = '900 176px "Big Shoulders", sans-serif';
  const grad = ctx.createLinearGradient(PAD, 180, PAD + 640, 330);
  grad.addColorStop(0, '#FFD983');
  grad.addColorStop(.5, '#FFC24B');
  grad.addColorStop(1, '#E39A16');
  ctx.fillStyle = grad;
  ctx.fillText('SEQUEL', PAD, 316);
  const sw = ctx.measureText('SEQUEL').width;
  ctx.font = '700 84px "Big Shoulders", sans-serif';
  ctx.fillStyle = '#F7F0E6';
  ctx.fillText('26', PAD + sw + 24, 316);

  ctx.font = '600 34px "Manrope", sans-serif';
  ctx.fillStyle = '#BCA9C6';
  ctx.fillText(data.event || 'Freshers — IIM Kozhikode, Kochi Campus', PAD, 372);

  /* ---- tear line ---- */
  ctx.strokeStyle = 'rgba(247,240,230,.26)';
  ctx.lineWidth = 3;
  ctx.setLineDash([14, 12]);
  ctx.beginPath(); ctx.moveTo(0, 470); ctx.lineTo(W, 470); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#100617';
  ctx.beginPath(); ctx.arc(0, 470, 34, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(W, 470, 34, 0, Math.PI * 2); ctx.fill();

  /* ---- name ---- */
  ctx.font = '500 24px "DM Mono", monospace';
  ctx.fillStyle = '#8F7E9C';
  ctx.letterSpacing = '5px';
  ctx.fillText('ADMIT', PAD, 590);
  ctx.letterSpacing = '0px';

  let size = 118;
  ctx.font = `800 ${size}px "Big Shoulders", sans-serif`;
  while (ctx.measureText(data.name.toUpperCase()).width > W - PAD * 2 && size > 46){
    size -= 4;
    ctx.font = `800 ${size}px "Big Shoulders", sans-serif`;
  }
  ctx.fillStyle = '#F7F0E6';
  ctx.fillText(data.name.toUpperCase(), PAD, 690);

  /* ---- batch + roll ---- */
  ctx.font = '500 30px "DM Mono", monospace';
  ctx.fillStyle = '#BCA9C6';
  ctx.fillText(`${data.batch}   ·   ${data.roll}`, PAD, 748);

  /* ---- the code block ---- */
  const boxY = 820, boxH = 250;
  ctx.fillStyle = 'rgba(255,194,75,.09)';
  roundRect(ctx, PAD, boxY, W - PAD * 2, boxH, 26);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,194,75,.42)';
  ctx.lineWidth = 3;
  roundRect(ctx, PAD, boxY, W - PAD * 2, boxH, 26);
  ctx.stroke();

  ctx.font = '500 24px "DM Mono", monospace';
  ctx.fillStyle = '#8F7E9C';
  ctx.letterSpacing = '5px';
  ctx.fillText('PASS CODE', PAD + 44, boxY + 68);
  ctx.letterSpacing = '0px';

  ctx.font = '500 96px "DM Mono", monospace';
  ctx.fillStyle = '#FFC24B';
  ctx.letterSpacing = '5px';
  ctx.fillText(data.code, PAD + 40, boxY + 178);
  ctx.letterSpacing = '0px';

  /* ---- detail rows ---- */
  const rows = [
    ['DATE',   data.date],
    ['VENUE',  data.venue],
    ['PAID',   data.amount]
  ];
  let ry = 1180;
  rows.forEach(([k, v]) => {
    ctx.font = '500 24px "DM Mono", monospace';
    ctx.fillStyle = '#8F7E9C';
    ctx.letterSpacing = '4px';
    ctx.fillText(k, PAD, ry);
    ctx.letterSpacing = '0px';
    ctx.font = '600 34px "Manrope", sans-serif';
    ctx.fillStyle = '#F7F0E6';
    ctx.textAlign = 'right';
    ctx.fillText(String(v), W - PAD, ry);
    ctx.textAlign = 'left';
    ctx.strokeStyle = 'rgba(247,240,230,.11)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(PAD, ry + 26); ctx.lineTo(W - PAD, ry + 26); ctx.stroke();
    ry += 82;
  });

  /* ---- footer ---- */
  ctx.font = '500 23px "Manrope", sans-serif';
  ctx.fillStyle = '#7A6A88';
  ctx.fillText('Show this at the entry desk. Non-transferable.', PAD, H - 62);
}

/* Canvas use alone does not trigger a webfont download — force it first,
   otherwise the pass silently renders in a fallback face. */
async function ensureFonts(){
  if (!document.fonts) return;
  try{
    await Promise.all([
      document.fonts.load('900 176px "Big Shoulders"'),
      document.fonts.load('800 118px "Big Shoulders"'),
      document.fonts.load('700 84px "Big Shoulders"'),
      document.fonts.load('500 96px "DM Mono"'),
      document.fonts.load('500 24px "DM Mono"'),
      document.fonts.load('600 34px "Manrope"'),
      document.fonts.load('500 23px "Manrope"')
    ]);
    await document.fonts.ready;
  }catch(e){ /* fall back to system fonts rather than failing the download */ }
}

async function renderPassCanvas(data){
  await ensureFonts();
  const c = document.createElement('canvas');
  c.width = PASS_W; c.height = PASS_H;
  drawPass(c.getContext('2d'), data);
  return c;
}

/* ---------- downloads ---------- */
function saveBlob(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

const passFilename = d => `SEQUEL26-${(d.name || 'pass').replace(/[^A-Za-z0-9]+/g, '-')}-${d.code}`;

async function downloadPassPNG(data){
  const c = await renderPassCanvas(data);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  saveBlob(blob, passFilename(data) + '.png');
}

async function downloadPassPDF(data){
  const c = await renderPassCanvas(data);
  const jpegUrl = c.toDataURL('image/jpeg', 0.94);
  const b64 = jpegUrl.split(',')[1];
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  saveBlob(buildPdfFromJpeg(bytes, PASS_W, PASS_H), passFilename(data) + '.pdf');
}

/**
 * Minimal single-page PDF wrapping one JPEG. No external library.
 */
function buildPdfFromJpeg(jpeg, imgW, imgH){
  const pageW = 420;                       // points
  const pageH = pageW * imgH / imgW;
  const chunks = [];
  let len = 0;
  const offsets = [];

  const put = s => {
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xFF;
    chunks.push(b); len += b.length;
  };
  const putBytes = b => { chunks.push(b); len += b.length; };
  const mark = () => offsets.push(len);

  put('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

  mark(); put('1 0 obj\n<</Type/Catalog/Pages 2 0 R>>\nendobj\n');
  mark(); put('2 0 obj\n<</Type/Pages/Kids[3 0 R]/Count 1>>\nendobj\n');
  mark(); put('3 0 obj\n<</Type/Page/Parent 2 0 R/MediaBox[0 0 ' +
              pageW.toFixed(2) + ' ' + pageH.toFixed(2) +
              ']/Resources<</XObject<</Im0 4 0 R>>>>/Contents 5 0 R>>\nendobj\n');

  mark();
  put('4 0 obj\n<</Type/XObject/Subtype/Image/Width ' + imgW + '/Height ' + imgH +
      '/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode/Length ' + jpeg.length + '>>\nstream\n');
  putBytes(jpeg);
  put('\nendstream\nendobj\n');

  const content = 'q ' + pageW.toFixed(2) + ' 0 0 ' + pageH.toFixed(2) + ' 0 0 cm /Im0 Do Q\n';
  mark(); put('5 0 obj\n<</Length ' + content.length + '>>\nstream\n' + content + 'endstream\nendobj\n');

  const xrefPos = len;
  let xref = 'xref\n0 6\n0000000000 65535 f \n';
  offsets.forEach(o => { xref += String(o).padStart(10, '0') + ' 00000 n \n'; });
  put(xref);
  put('trailer\n<</Size 6/Root 1 0 R>>\nstartxref\n' + xrefPos + '\n%%EOF\n');

  const out = new Uint8Array(len);
  let p = 0;
  chunks.forEach(c => { out.set(c, p); p += c.length; });
  return new Blob([out], { type: 'application/pdf' });
}
