/* =====================================================================
   Minimal QR encoder — byte mode, EC level M, versions 1–10.
   Enough for any UPI URI (they run ~60–120 characters).

   Exists so the payment QR is generated from the live UPI ID and the
   live price. A static QR image goes stale the moment you change the
   ticket price; this one cannot.

   qrMatrix(text) -> array of arrays of 0/1
   drawQR(canvas, text, opts)
   ===================================================================== */

/* ---------- GF(256) for Reed-Solomon ---------- */
const GF_EXP = new Uint8Array(512), GF_LOG = new Uint8Array(256);
(function(){
  let x = 1;
  for (let i = 0; i < 255; i++){
    GF_EXP[i] = x; GF_LOG[x] = i;
    x <<= 1; if (x & 0x100) x ^= 0x11D;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();
const gfMul = (a,b) => (a === 0 || b === 0) ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]];

function rsGenerator(n){
  let poly = [1];
  for (let i = 0; i < n; i++){
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++){
      next[j]     ^= poly[j];                        // x term — keeps it monic
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i]);      // alpha^i term
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data, ecLen){
  const gen = rsGenerator(ecLen);
  const res = new Array(ecLen).fill(0);
  for (let i = 0; i < data.length; i++){
    const factor = data[i] ^ res[0];
    res.shift(); res.push(0);
    if (factor !== 0) for (let j = 0; j < gen.length - 1; j++) res[j] ^= gfMul(gen[j + 1], factor);
  }
  return res;
}

/* ---------- tables (EC level M, versions 1–10) ----------
   [ecPerBlock, blocksG1, dataG1, blocksG2, dataG2] */
const EC_M = {
  1:[10,1,16,0,0],  2:[16,1,28,0,0],  3:[26,1,44,0,0],  4:[18,2,32,0,0],  5:[24,2,43,0,0],
  6:[16,4,27,0,0],  7:[18,4,31,0,0],  8:[22,2,38,2,39], 9:[22,3,36,2,37], 10:[26,4,43,1,44]
};
/* byte-mode capacity in characters, level M */
const CAP_M = {1:14,2:26,3:42,4:62,5:84,6:106,7:122,8:152,9:180,10:213};
const ALIGN = {
  1:[], 2:[6,18], 3:[6,22], 4:[6,26], 5:[6,30],
  6:[6,34], 7:[6,22,38], 8:[6,24,42], 9:[6,26,46], 10:[6,28,50]
};

/* ---------- BCH bits ---------- */
function bchFormat(data){                       // 5 data bits -> 15 bits
  let d = data << 10;
  for (let i = 4; i >= 0; i--) if (d & (1 << (i + 10))) d ^= 0x537 << i;
  return ((data << 10) | d) ^ 0x5412;
}
function bchVersion(v){                          // 6 data bits -> 18 bits
  let d = v << 12;
  for (let i = 5; i >= 0; i--) if (d & (1 << (i + 12))) d ^= 0x1F25 << i;
  return (v << 12) | d;
}

/* ---------- encode ---------- */
function toBytes(str){
  const out = [];
  for (const ch of unescape(encodeURIComponent(str))) out.push(ch.charCodeAt(0) & 0xFF);
  return out;
}

function buildCodewords(bytes, version){
  const [ecLen, b1, d1, b2, d2] = EC_M[version];
  const totalData = b1 * d1 + b2 * d2;
  const countBits = version >= 10 ? 16 : 8;

  /* bit stream */
  const bits = [];
  const push = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1); };
  push(0b0100, 4);                 // byte mode
  push(bytes.length, countBits);
  bytes.forEach(b => push(b, 8));

  const cap = totalData * 8;
  for (let i = 0; i < 4 && bits.length < cap; i++) bits.push(0);   // terminator
  while (bits.length % 8) bits.push(0);

  const data = [];
  for (let i = 0; i < bits.length; i += 8){
    let v = 0; for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
    data.push(v);
  }
  const PAD = [0xEC, 0x11];
  for (let i = 0; data.length < totalData; i++) data.push(PAD[i % 2]);

  /* split into blocks, add EC */
  const dBlocks = [], eBlocks = [];
  let pos = 0;
  for (let i = 0; i < b1; i++){ const b = data.slice(pos, pos + d1); pos += d1; dBlocks.push(b); eBlocks.push(rsEncode(b, ecLen)); }
  for (let i = 0; i < b2; i++){ const b = data.slice(pos, pos + d2); pos += d2; dBlocks.push(b); eBlocks.push(rsEncode(b, ecLen)); }

  /* interleave */
  const out = [];
  const maxD = Math.max(d1, d2);
  for (let i = 0; i < maxD; i++) dBlocks.forEach(b => { if (i < b.length) out.push(b[i]); });
  for (let i = 0; i < ecLen; i++) eBlocks.forEach(b => out.push(b[i]));
  return out;
}

/* ---------- matrix ---------- */
function placeFunctionPatterns(m, res, version){
  const size = m.length;

  const finder = (r, c) => {
    for (let i = -1; i <= 7; i++) for (let j = -1; j <= 7; j++){
      const y = r + i, x = c + j;
      if (y < 0 || y >= size || x < 0 || x >= size) continue;
      const on = (i >= 0 && i <= 6 && (j === 0 || j === 6)) ||
                 (j >= 0 && j <= 6 && (i === 0 || i === 6)) ||
                 (i >= 2 && i <= 4 && j >= 2 && j <= 4);
      m[y][x] = on ? 1 : 0; res[y][x] = 1;
    }
  };
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);

  for (let i = 8; i < size - 8; i++){
    const on = i % 2 === 0 ? 1 : 0;
    m[6][i] = on; res[6][i] = 1;
    m[i][6] = on; res[i][6] = 1;
  }

  const pos = ALIGN[version];
  pos.forEach(r => pos.forEach(c => {
    if ((r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8)) return;
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++){
      m[r + i][c + j] = (Math.abs(i) === 2 || Math.abs(j) === 2 || (i === 0 && j === 0)) ? 1 : 0;
      res[r + i][c + j] = 1;
    }
  }));

  m[size - 8][8] = 1; res[size - 8][8] = 1;              // dark module

  for (let i = 0; i < 9; i++){                            // reserve format areas
    if (i !== 6){ res[8][i] = 1; res[i][8] = 1; }
  }
  for (let i = 0; i < 8; i++){ res[8][size - 1 - i] = 1; res[size - 1 - i][8] = 1; }

  if (version >= 7){                                      // version info
    const v = bchVersion(version);
    for (let i = 0; i < 18; i++){
      const bit = (v >> i) & 1;
      const r = Math.floor(i / 3), c = i % 3;
      m[size - 11 + c][r] = bit; res[size - 11 + c][r] = 1;
      m[r][size - 11 + c] = bit; res[r][size - 11 + c] = 1;
    }
  }
}

function placeData(m, res, cw){
  const size = m.length;
  let bitIdx = 0, up = true;
  const bitAt = i => (cw[i >> 3] >> (7 - (i & 7))) & 1;
  const total = cw.length * 8;

  for (let right = size - 1; right > 0; right -= 2){
    if (right === 6) right = 5;
    for (let step = 0; step < size; step++){
      const r = up ? size - 1 - step : step;
      for (let k = 0; k < 2; k++){
        const c = right - k;
        if (res[r][c]) continue;
        m[r][c] = bitIdx < total ? bitAt(bitIdx) : 0;
        bitIdx++;
      }
    }
    up = !up;
  }
}

const MASKS = [
  (i,j) => (i + j) % 2 === 0,
  (i,j) => i % 2 === 0,
  (i,j) => j % 3 === 0,
  (i,j) => (i + j) % 3 === 0,
  (i,j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
  (i,j) => ((i * j) % 2) + ((i * j) % 3) === 0,
  (i,j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0,
  (i,j) => (((i + j) % 2) + ((i * j) % 3)) % 2 === 0
];

function applyFormat(m, res, mask){
  const size = m.length;
  const f = bchFormat((0b00 << 3) | mask);          // 00 = EC level M
  for (let i = 0; i < 15; i++){
    const bit = (f >> i) & 1;
    if (i < 6)       m[i][8] = bit;
    else if (i < 8)  m[i + 1][8] = bit;
    else if (i === 8)m[8][7] = bit;
    else             m[8][14 - i] = bit;

    if (i < 8) m[8][size - 1 - i] = bit;
    else       m[size - 15 + i][8] = bit;
  }
}

function penalty(m){
  const n = m.length;
  let score = 0;

  const run = get => {
    for (let a = 0; a < n; a++){
      let last = -1, count = 0;
      for (let b = 0; b < n; b++){
        const v = get(a, b);
        if (v === last) { count++; }
        else { if (count >= 5) score += 3 + (count - 5); last = v; count = 1; }
      }
      if (count >= 5) score += 3 + (count - 5);
    }
  };
  run((a,b) => m[a][b]);
  run((a,b) => m[b][a]);

  for (let i = 0; i < n - 1; i++) for (let j = 0; j < n - 1; j++){
    const v = m[i][j];
    if (v === m[i][j+1] && v === m[i+1][j] && v === m[i+1][j+1]) score += 3;
  }

  const P1 = [1,0,1,1,1,0,1,0,0,0,0], P2 = [0,0,0,0,1,0,1,1,1,0,1];
  const seq = (get, a, b, p) => { for (let k = 0; k < 11; k++) if (get(a, b + k) !== p[k]) return false; return true; };
  for (let i = 0; i < n; i++) for (let j = 0; j <= n - 11; j++){
    if (seq((a,b)=>m[a][b], i, j, P1) || seq((a,b)=>m[a][b], i, j, P2)) score += 40;
    if (seq((a,b)=>m[b][a], i, j, P1) || seq((a,b)=>m[b][a], i, j, P2)) score += 40;
  }

  let dark = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) dark += m[i][j];
  score += 10 * Math.floor(Math.abs(dark * 100 / (n * n) - 50) / 5);
  return score;
}

function qrMatrix(text){
  const bytes = toBytes(text);
  let version = 0;
  for (let v = 1; v <= 10; v++) if (bytes.length <= CAP_M[v]) { version = v; break; }
  if (!version) throw new Error('Text too long for this QR encoder (max ' + CAP_M[10] + ' bytes).');

  const size = version * 4 + 17;
  const cw = buildCodewords(bytes, version);

  const blank = () => Array.from({length: size}, () => new Array(size).fill(0));
  const base = blank(), res = blank();
  placeFunctionPatterns(base, res, version);
  placeData(base, res, cw);

  let best = null, bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++){
    const m = base.map(r => r.slice());
    for (let i = 0; i < size; i++) for (let j = 0; j < size; j++){
      if (!res[i][j] && MASKS[mask](i, j)) m[i][j] ^= 1;
    }
    applyFormat(m, res, mask);
    const s = penalty(m);
    if (s < bestScore){ bestScore = s; best = m; }
  }
  return best;
}

/* ---------- render ---------- */
function drawQR(canvas, text, opts){
  const o = Object.assign({ dark:'#100617', light:'#F7F0E6', quiet:4, size:520 }, opts || {});
  const m = qrMatrix(text);
  const n = m.length;
  const total = n + o.quiet * 2;
  const scale = Math.max(1, Math.floor(o.size / total));
  const px = total * scale;

  canvas.width = px; canvas.height = px;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = o.light; ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = o.dark;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++){
    if (m[i][j]) ctx.fillRect((j + o.quiet) * scale, (i + o.quiet) * scale, scale, scale);
  }
  return canvas;
}

/* ---------- UPI link ---------- */
function upiURI(vpa, payeeName, amount, note){
  const q = [
    'pa=' + encodeURIComponent(vpa),
    'pn=' + encodeURIComponent(payeeName),
    'cu=INR'
  ];
  if (amount) q.push('am=' + encodeURIComponent(String(amount)));
  if (note)   q.push('tn=' + encodeURIComponent(note));
  return 'upi://pay?' + q.join('&');
}
