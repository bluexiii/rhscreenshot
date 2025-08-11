// Investing screenshot composer – templates + user inputs + generated curve

const dom = {
  initial: document.getElementById('initial'),
  amount: document.getElementById('amount'),
  percent: document.getElementById('percent'),
  periodChips: document.getElementById('periodChips'),
  btnRender: document.getElementById('btnRender'),
  btnDownload: document.getElementById('btnDownload'),
  canvas: document.getElementById('canvas'),
  message: document.getElementById('message'),
  zoom: document.getElementById('zoom'),
  zoomLabel: document.getElementById('zoomLabel')
};

const ctx = dom.canvas.getContext('2d');

// State
let templateImg = null;

function setMessage(t){ if(dom.message) dom.message.textContent = t || ''; }

function loadImageUrl(url){
  return new Promise((resolve)=>{
    const img = new Image();
    img.onload = ()=> resolve(img);
    img.onerror = ()=> resolve(null);
    // cache-bust to avoid stale cache during development
    const sep = url.includes('?') ? '&' : '?';
    img.src = `${url}${sep}t=${Date.now()}`;
  });
}

function formatCurrency(value){
  const n = Number(value);
  if(Number.isNaN(n)) return '$0.00';
  return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(n);
}

function getSelectedPeriod(){
  const el = dom.periodChips.querySelector('input[name="period"]:checked');
  return el ? el.value : '3M';
}

function randomTime12h(){
  // 限制在 1:00 - 9:59 范围内（12 小时制，且小于 10:00）
  const h = Math.floor(Math.random()*9)+1; // 1-9
  const m = Math.floor(Math.random()*60);
  return `${h}:${String(m).padStart(2,'0')}`;
}

function fitFontSize(text, family, weight, maxWidth, maxHeight){
  let lo = 10, hi = 240, best = 118;
  const make = s => `${weight} ${s}px ${family}`;
  while(lo <= hi){
    const mid = Math.floor((lo+hi)/2);
    ctx.font = make(mid);
    const m = ctx.measureText(text);
    const w = m.width;
    const h = Math.abs(m.actualBoundingBoxAscent)+Math.abs(m.actualBoundingBoxDescent) || mid;
    if(w <= maxWidth && h <= maxHeight){ best = mid; lo = mid+1; } else { hi = mid-1; }
  }
  return `${weight} ${best}px ${family}`;
}

function drawRoundedRectPath(x, y, w, h, r){
  const radius = Math.min(r, w/2, h/2);
  ctx.beginPath();
  ctx.moveTo(x+radius, y);
  ctx.lineTo(x+w-radius, y);
  ctx.quadraticCurveTo(x+w, y, x+w, y+radius);
  ctx.lineTo(x+w, y+h-radius);
  ctx.quadraticCurveTo(x+w, y+h, x+w-radius, y+h);
  ctx.lineTo(x+radius, y+h);
  ctx.quadraticCurveTo(x, y+h, x, y+h-radius);
  ctx.lineTo(x, y+radius);
  ctx.quadraticCurveTo(x, y, x+radius, y);
  ctx.closePath();
}

// 基于收益百分比生成一条有上升/下降趋势的随机曲线
function drawGeneratedCurve(area, percent, chipsY, startLiftPx = 60){
  const ctx2 = ctx;
  const points = 240; // 平滑度
  const noiseBase = 0.5; // 基础波动更小
  const noise = noiseBase + Math.min(0.10, Math.abs(percent)/400); // 收益越大，波动略增，但受限
  const trend = Math.sign(percent) * Math.min(0.6, Math.abs(percent)/100); // 控制总体趋势

  // 生成随机行走数据并叠加趋势
  const values = [];
  let v = 0;
  for(let i=0;i<points;i++){
    const t = i/(points-1);
    const rnd = (Math.random()*2-1) * noise; // [-noise, noise]
    // 细小抖动 + 线性趋势分摊到每步
    const step = rnd + trend/points;
    // 让走势更顺滑：当总体趋势向上时，限制过大的向下跳；向下同理
    if (trend >= 0 && step < 0) {
      v += step * 0.35;
    } else if (trend < 0 && step > 0) {
      v += step * 0.35;
    } else {
      v += step;
    }
    values.push(v);
  }
  // 轻微平滑（移动平均）
  const window = 3;
  const smooth = values.map((_, i) => {
    let s = 0, c = 0;
    for (let k = -Math.floor(window/2); k <= Math.floor(window/2); k++){
      const idx = i + k;
      if (idx >= 0 && idx < values.length){ s += values[idx]; c++; }
    }
    return s / c;
  });
  // 归一化到 [0,1]
  const min = Math.min(...smooth);
  const max = Math.max(...smooth);
  const range = Math.max(1e-6, max-min);
  const norm = smooth.map(x => (x - min) / range);

  // 不再使用黑色覆盖清空区域，直接在模板上叠加曲线

  // 绘制绿色曲线
  ctx2.save();
  ctx2.beginPath();
  ctx2.strokeStyle = '#00C805';
  ctx2.lineWidth = Math.max(2, Math.round(area.h * 0.006)); // 更细
  const stepX = area.w/(points-1);
  // 起点锚定于 chips 上方 6px，并在左侧一段内平滑过渡
  const chipsLimitY = (chipsY ?? (area.y + area.h));
  const yStart = Math.max(area.y + 4, Math.min(chipsLimitY - 6, area.y + area.h - 6));
  const anchorSpan = Math.max(8, Math.floor(points * 0.06));
  const blendSpan = Math.max(16, Math.floor(points * 0.12));
  for(let i=0;i<points;i++){
    const x = area.x + i*stepX;
    let y = area.y + (1-norm[i]) * area.h;
    if (i === 0) {
      y = yStart;
    } else if (i < anchorSpan) {
      y = yStart; // 前若干点保持固定高度
    } else if (i < anchorSpan + blendSpan) {
      const t = (i - anchorSpan) / blendSpan; // 0→1
      y = yStart * (1 - t) + y * t; // 从起点高度平滑过渡到随机曲线
    }
    // 边界保护
    const minY = area.y + 4;
    // 保护：不超过 chips 行（留出 6px 缓冲）
    const maxY = (chipsY ?? (area.y + area.h)) - 60;
    if (y > maxY) y = maxY;
    if (y < minY) y = minY;
    if(i===0) ctx2.moveTo(x,y); else ctx2.lineTo(x,y);
  }
  ctx2.stroke();
  ctx2.restore();
}


function render(){
  if(!templateImg){ setMessage('未找到模板：assets/template.png'); return; }
  setMessage('生成中…');

  const canvasW = templateImg.width; // 保持与模板一致
  const canvasH = templateImg.height;
  dom.canvas.width = canvasW;
  dom.canvas.height = canvasH;

  // 1) 画模板
  ctx.clearRect(0,0,canvasW,canvasH);
  ctx.drawImage(templateImg,0,0,canvasW,canvasH);

  // 1.1) 覆盖左上角时间并随机生成一个 12H 时间（针对 1290x2796 模板微调）
  const timeText = randomTime12h();
  const TIME = {
    fontFamily: '"SF Pro Text", -apple-system, BlinkMacSystemFont, Inter, sans-serif',
    fontWeight: 500,
    sizeRatio: 0.020,   // 相对高度
    xRatio: 0.112,      // 更靠左
    yRatio: 0.022       // 更靠上
  };
  const timeSize = Math.round(canvasH * TIME.sizeRatio);
  ctx.font = `${TIME.fontWeight} ${timeSize}px ${TIME.fontFamily}`;
  ctx.textBaseline = 'top';
  const timeX = Math.round(canvasW * TIME.xRatio);
  const timeY = Math.round(canvasH * TIME.yRatio);
  const mtx = ctx.measureText(timeText);
  const textH = Math.abs(mtx.actualBoundingBoxAscent)+Math.abs(mtx.actualBoundingBoxDescent) || timeSize;
  const padX = Math.round(timeSize * 0.30);
  const padY = Math.round(timeSize * 0.20);
  // 不再使用黑色覆盖时间区域，直接叠加时间
  ctx.fillStyle = '#ffffff';
  ctx.fillText(timeText, timeX, timeY);

  // 2) 中央曲线：按收益百分比随机生成
  const chartArea = {
    x: Math.round(canvasW * 0.05),
    y: Math.round(canvasH * 0.32),
    w: Math.round(canvasW * 0.90),
    h: Math.round(canvasH * 0.30)
  };

  // 3) 文案覆盖（金额、收益+周期）
  // 三者关系：总金额 = 初始金额 * (1 + 收益百分比)
  let initial = Number(dom.initial.value || 0);
  let amount = Number(dom.amount.value || 0);
  let percent = Number(dom.percent.value || 0);
  if (initial && percent && !amount) amount = initial * (1 + percent/100);
  if (initial && amount && !percent) percent = (amount/initial - 1) * 100;
  if (amount && percent && !initial) initial = amount / (1 + percent/100);

  // 将回算的数回填到输入框，方便下次编辑
  if (dom.initial.value === "" && initial) dom.initial.value = initial.toFixed(2);
  if (dom.amount.value === "" && amount) dom.amount.value = amount.toFixed(2);
  if (dom.percent.value === "" && !Number.isNaN(percent)) dom.percent.value = percent.toFixed(2);

  const amountText = formatCurrency(amount);
  percent = Number(percent);
  const isPos = percent >= 0;
  const gainValue = amount - initial;
  const percentText = `${isPos ? '▲' : '▼'} ${formatCurrency(Math.abs(gainValue)).replace('$','')}` + ` (${percent.toFixed(2)}%)`;
  const period = getSelectedPeriod();

  // 根据收益绘制曲线（放在文本之前以便文字覆盖其上）
  drawGeneratedCurve(chartArea, percent, Math.round(canvasH * 0.5778), 60);

  // 字体：若上传自定义字体则用之，否则使用近似 SF Pro
  const family = '"SF Pro Display", -apple-system, BlinkMacSystemFont, Inter, sans-serif';

  // 金额：左上区域，自动适配宽高
  const left = Math.round(canvasW*0.06);
  const safeRight = Math.round(canvasW*0.06);
  const amountTop = Math.round(canvasH*0.165); // 上移一些
  const safeW = canvasW - left - safeRight;
  const SCALE = 0.5; // 按需求整体缩小到 50%
  const amountFont = fitFontSize(
    amountText,
    family,
    500,
    Math.round(safeW * SCALE),
    Math.round(canvasH * 0.08 * SCALE)
  );
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'top';
  ctx.font = amountFont;
  ctx.fillText(amountText, left, amountTop);

  // 收益+周期：在金额下方一行（收益绿色，周期短语白色），整体上移更明显
  const gainTop = amountTop + Math.round(canvasH*0.042);
  const gainFont = `600 ${Math.round(canvasH*0.025 * SCALE)}px ${family}`;
  ctx.font = gainFont;
  const gainDollar = formatCurrency(Math.abs(gainValue)).replace('$','');
  const greenPart = `${isPos ? '▲' : '▼'} ${gainDollar} (${percent.toFixed(2)}%) `; // 末尾空格用于分隔
  ctx.fillStyle = isPos ? '#00C805' : '#ef4444';
  ctx.fillText(greenPart, left, gainTop);
  const greenWidth = ctx.measureText(greenPart).width;
  ctx.fillStyle = '#ffffff';
  const phrase = mapPeriodPhraseHuman(period);
  ctx.fillText(phrase, left + greenWidth, gainTop);

  // 4) 周期 chips：根据选择渲染绿色胶囊 + 黑色文字，其余为绿色文字
  const chipLabels = ['1D','1W','1M','3M','YTD','1Y','ALL'];
  const selected = period;
  const CHIPS = {
    y: Math.round(canvasH * 0.5778),
    startX: Math.round(canvasW * 0.06),
    endX: Math.round(canvasW * 0.825), // 不覆盖最右侧齿轮图标区域
    gap: Math.round(canvasW * 0.07),
    fontSize: Math.round(canvasH * 0.015),
    pillPaddingX: Math.round(canvasW * 0.02),
    pillHeight: Math.round(canvasH * 0.026),
    pillYOffsetFactor: 0.24, // 选中胶囊相对基线向上的偏移比例（越小越靠下）
    radius: 22,
    green: '#00C805',
    black: '#051b0c'
  };

  // 不再使用黑色覆盖 chips 区域，直接叠加绘制选中胶囊

  ctx.font = `500 ${CHIPS.fontSize}px ${family}`;
  const slotStep = (CHIPS.endX - CHIPS.startX) / (chipLabels.length - 1);
  chipLabels.forEach((label, idx) => {
    const isSel = label === selected;
    const anchorX = Math.round(CHIPS.startX + slotStep * idx);
    const textW = ctx.measureText(label).width;
    const textX = anchorX - Math.round(textW / 2);
    if (isSel) {
      const rectW = textW + CHIPS.pillPaddingX * 2;
      const rectX = anchorX - Math.round(rectW / 2);
      const rectY = CHIPS.y - Math.round(CHIPS.pillHeight * CHIPS.pillYOffsetFactor);
      drawRoundedRectPath(rectX, rectY, rectW, CHIPS.pillHeight, CHIPS.radius);
      ctx.fillStyle = CHIPS.green; ctx.fill();
      ctx.fillStyle = CHIPS.black;
      ctx.fillText(label, textX, CHIPS.y);
    } else {
      ctx.fillStyle = CHIPS.green;
      ctx.fillText(label, textX, CHIPS.y);
    }
  });

  dom.btnDownload.disabled = false;
  setMessage('已生成');
}

dom.btnRender.addEventListener('click', async () =>{
  try{
    setMessage('正在生成…');
    if(!templateImg){ templateImg = await loadImageUrl('./assets/template.png'); }
    if(!templateImg){ setMessage('未找到模板：assets/template.png'); return; }
    render();
  }catch(e){ console.error(e); setMessage('生成失败，请在控制台查看错误'); }
});

dom.btnDownload.addEventListener('click', ()=>{
  const url = dom.canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url; a.download = `investing-${Date.now()}.png`;
  document.body.appendChild(a); a.click(); a.remove();
});

// 初次加载时尝试自动载入模板并生成一次
window.addEventListener('DOMContentLoaded', async () => {
  setMessage('加载模板中…');
  templateImg = await loadImageUrl('./assets/template.png');
  if(templateImg){ render(); } else { setMessage('未找到模板：请将图片放在 assets/template.png'); }
});
 
// 缩放预览（仅影响显示尺寸，不影响导出像素）
function applyZoom(){
  if(!dom.zoom) return;
  const scale = Number(dom.zoom.value || 1);
  dom.canvas.style.transform = `scale(${scale})`;
  if(dom.zoomLabel) dom.zoomLabel.textContent = `${Math.round(scale*100)}%`;
}

dom.zoom?.addEventListener('input', applyZoom);
applyZoom();

// 周期短语映射（按你的要求）
function mapPeriodPhraseHuman(p){
  switch(p){
    case '1D': return 'Today';
    case '1W': return 'Past week';
    case '1M': return 'Past month';
    case '3M': return 'Past 3 months';
    case 'YTD': return 'Year to date';
    case '1Y': return 'Past year';
    case 'ALL': return 'All time';
    default: return 'Past period';
  }
}

// 动态联动三个输入，确保总金额 = 初始金额 * (1 + 收益)
function wireInputsConstraint(){
  const recompute = (changed) => {
    const initial = parseFloat(dom.initial.value || '0');
    const amount = parseFloat(dom.amount.value || '0');
    const percent = parseFloat(dom.percent.value || '');
    if (changed === 'initial') {
      // initial 改动 → 若 percent 有值，更新 amount；否则若 amount 有值，更新 percent
      if (!Number.isNaN(percent)) {
        dom.amount.value = (initial * (1 + percent/100)).toFixed(2);
      } else if (!Number.isNaN(amount) && initial) {
        dom.percent.value = (((amount/initial) - 1) * 100).toFixed(2);
      }
    } else if (changed === 'amount') {
      if (initial) {
        dom.percent.value = (((amount/initial) - 1) * 100).toFixed(2);
      }
    } else if (changed === 'percent') {
      if (initial || initial === 0) {
        dom.amount.value = (initial * (1 + (Number(dom.percent.value||0)/100))).toFixed(2);
      }
    }
  };
  dom.initial.addEventListener('input', () => recompute('initial'));
  dom.amount.addEventListener('input', () => recompute('amount'));
  dom.percent.addEventListener('input', () => recompute('percent'));
}

wireInputsConstraint();



