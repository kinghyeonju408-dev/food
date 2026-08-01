// data
const CATS = {
  "음료":{color:"#B4653E"}, "과자·디저트":{color:"#C08A2E"}, "조미료·당류":{color:"#A85A4E"},
  "즉석식품·면류":{color:"#8C5A3C"}, "육가공품":{color:"#C4784F"},
  "신선식품(단백질)":{color:"#4C7A5A"}, "신선식품(과일)":{color:"#6E9C6F"},
};

// perServing: 1회 섭취량 기준 영양성분
const ITEMS = [
  {brand:"코카콜라음료", name:"코카콜라 355ml", price:4000, category:"음료",
   unitsPurchased:2, unitLabel:"캔", servingLabel:"1캔(355ml)",
   perServing:{kcal:160, sugar:39, sodium:21},
   swap:{brand:"코카콜라음료", to:"코카콜라 제로 355ml 2캔", price:4000, sugarDelta:78, sodiumDelta:-2,
     note:"이번에 산 2캔 전체를 제로로 바꾸면 당류 78g을 전량 줄이고 카페인·탄산감은 그대로 유지해요.", buyable:true}},
  {brand:"오리온", name:"초코파이", price:4200, category:"과자·디저트",
   unitsPurchased:12, unitLabel:"개", servingLabel:"1개(39g)",
   perServing:{kcal:171, sugar:12, sodium:90},
   swap:{brand:"예시 저당 제품", to:"저당 오트그래놀라바 12개입", price:6000, sugarDelta:96, sodiumDelta:520,
     note:"박스 전체(12개)를 그래놀라바로 바꾸면 당류 96g, 나트륨 520mg을 줄일 수 있어요. 다만 총 비용은 늘어요.", buyable:true}},
  {brand:"CJ제일제당", name:"백설 하얀설탕", price:3000, category:"조미료·당류",
   unitsPurchased:100, unitLabel:"회분", servingLabel:"1큰술(10g)", isBulk:true,
   perServing:{kcal:39, sugar:10, sodium:0},
   swap:{brand:"예시 대체감미료", to:"알룰로스 1kg", price:9000, sugarDelta:970, sodiumDelta:0,
     note:"1kg 전체를 알룰로스로 바꾸면 체내에 흡수되는 당이 거의 사라져요. 다만 설탕보다 3배가량 비싸요.", buyable:true}},
  {brand:"농심", name:"신라면", price:4500, category:"즉석식품·면류",
   unitsPurchased:5, unitLabel:"봉지", servingLabel:"1봉지(120g)",
   perServing:{kcal:500, sugar:4, sodium:1790},
   swap:{brand:"습관 개선 팁", to:"수프 60%만 사용", price:4500, sugarDelta:0, sodiumDelta:716,
     note:"나트륨의 70~80%가 스프에 있어요. 스프를 60%만 넣으면 1봉지 기준 나트륨을 약 716mg(40%) 줄일 수 있어요.", buyable:false}},
  {brand:"하림", name:"프랑크소시지", price:5900, category:"육가공품",
   unitsPurchased:5, unitLabel:"회분(2개)", servingLabel:"2개(약 40g)",
   perServing:{kcal:112, sugar:0.4, sodium:320},
   swap:{brand:"예시 저나트륨 제품", to:"닭가슴살 소시지 200g", price:6800, sugarDelta:0, sodiumDelta:700,
     note:"팩 전체를 닭가슴살 소시지로 바꾸면 나트륨을 약 700mg 줄이면서 단백질 비율은 비슷하게 유지돼요.", buyable:true}},
  {brand:"동물복지", name:"계란", price:7900, category:"신선식품(단백질)",
   unitsPurchased:30, unitLabel:"개", servingLabel:"1개(60g)",
   perServing:{kcal:70, sugar:0, sodium:70}, swap:null},
  {brand:"국내산", name:"바나나", price:3500, category:"신선식품(과일)",
   unitsPurchased:5, unitLabel:"개", servingLabel:"1개(100g)",
   perServing:{kcal:89, sugar:12, sodium:1}, swap:null},
];

// 안전한 분류 함수
function classify(item){
  if(!item) return { level:'safe', tag:'✔ 안전 (정보 없음)' };
  if(item.category && String(item.category).startsWith("신선식품")) {
    return { level:'safe', tag:'✔ 안전(신선식품)' };
  }
  const s = item.perServing || { kcal:0, sugar:0, sodium:0 };
  const sugarHigh = Number(document.getElementById('sugarSlider')?.value) || 25;
  const sodiumHigh = Number(document.getElementById('sodiumSlider')?.value) || 800;
  const sugarCaution = sugarHigh * 0.4;
  const sodiumCaution = sodiumHigh * 0.4;
  const sugarVal = Number(s.sugar || 0);
  const sodiumVal = Number(s.sodium || 0);
  if(sugarVal >= sugarHigh) return { level:'high', tag:'⚠ 고당류 (1회 섭취 기준)' };
  if(sodiumVal >= sodiumHigh) return { level:'high', tag:'⚠ 고나트륨 (1회 섭취 기준)' };
  if(sugarVal >= sugarCaution) return { level:'caution', tag:'△ 당류 주의 (1회 섭취 기준)' };
  if(sodiumVal >= sodiumCaution) return { level:'caution', tag:'△ 나트륨 주의 (1회 섭취 기준)' };
  return { level:'safe', tag:'✔ 안전 (1회 섭취 기준)' };
}

// UI 업데이트 함수들
function onSliderChange(){
  document.getElementById('sugarVal').textContent = document.getElementById('sugarSlider').value+'g';
  document.getElementById('sodiumVal').textContent = document.getElementById('sodiumSlider').value+'mg';
  let highCount = 0;
  ITEMS.forEach((it,i)=>{
    const el = document.getElementById('line'+i);
    if(!el || !el.classList.contains('done')) return;
    const {level,tag} = classify(it);
    el.classList.remove('flag-high','flag-caution','flag-safe');
    el.classList.add('flag-'+level);
    const tagEl = el.querySelector('.tag');
    if(tagEl) tagEl.textContent = tag;
    if(level==='high') highCount++;
  });
  const summaryEl = document.getElementById('summary');
  if(summaryEl && summaryEl.style.display==='grid'){
    const stamp = document.getElementById('stamp');
    if(stamp){
      if(highCount>0){ stamp.classList.remove('safe'); stamp.innerHTML = '대사 위험군<small>METABOLIC RISK</small>'; }
      else { stamp.classList.add('safe'); stamp.innerHTML = '위험 품목 없음<small>ALL CLEAR</small>'; }
    }
  }
}

function onHouseholdChange(){
  const h = Number(document.getElementById('householdSlider')?.value) || 1;
  const hv = document.getElementById('householdVal');
  if(hv) hv.textContent = h+'명';
  ITEMS.forEach((it,i)=>{
    const el = document.querySelector('#line'+i+' .perperson');
    if(!el) return;
    if(it.isBulk){ el.textContent = `조미료류는 가구원수와 무관하게 1회 사용량 기준으로 판단해요`; return; }
    const perPerson = (Number(it.unitsPurchased || 1) / h).toFixed(1);
    el.textContent = `👪 ${h}인 가구 기준 1인당 약 ${perPerson}${String(it.unitLabel||'개').replace(/\(.*\)/,'')}분`;
  });
}

// 파이프라인
const STAGES = [{n:1,lab:"이커머스 마이데이터"},{n:2,lab:"유통사 전자영수증"},{n:3,lab:"동네마트 OCR"}];
const activeStage = 2;
(function buildPipeline(){
  const pipelineEl = document.getElementById('pipeline');
  if(!pipelineEl) return;
  pipelineEl.innerHTML = '';
  STAGES.forEach(s=>{
    const div = document.createElement('div');
    div.className = 'step' + (s.n<activeStage?' done':'') + (s.n===activeStage?' active':'');
    div.innerHTML = `<div class="dot">${s.n<activeStage?'✓':s.n}</div><div class="lab">${s.lab}</div>`;
    pipelineEl.appendChild(div);
  });
})();

// receipt lines 렌더링
function renderReceiptLines(){
  const linesEl = document.getElementById('lines');
  if(!linesEl) return;
  linesEl.innerHTML = '';
  ITEMS.forEach((it,i)=>{
    const div = document.createElement('div');
    div.className = 'rline'; div.id = 'line'+i;
    div.innerHTML = `<div class="brand">${it.brand||''}</div><div class="name">${it.name}</div>
      <div class="price">${Number(it.price||0).toLocaleString()}원</div>
      <div class="qty">${it.unitsPurchased||1}${it.unitLabel||'개'} · 1회 섭취 기준 ${it.servingLabel||''}</div>
      <div class="perperson"></div>
      <div class="tag"></div>`;
    linesEl.appendChild(div);
  });
  const totalEl = document.getElementById('totalPrice');
  if(totalEl) totalEl.textContent = ITEMS.reduce((s,i)=>s+Number(i.price||0),0).toLocaleString()+'원';
  onHouseholdChange();
}
renderReceiptLines();

// ledger: 카테고리 바, legend, insight
(function buildLedger(){
  const totals = {};
  ITEMS.forEach(it=>{
    const cat = it.category || '기타';
    totals[cat] = (totals[cat] || 0) + Number(it.price || 0);
  });

  const grand = Object.values(totals).reduce((a,b)=>a+b,0);
  const catbar = document.getElementById('catbar');
  const legend = document.getElementById('catlegend');
  if(catbar) catbar.innerHTML = '';
  if(legend) legend.innerHTML = '';

  if(!grand){
    const insightEl = document.getElementById('catInsight');
    if(insightEl) insightEl.textContent = '항목이 없습니다.';
    return;
  }

  Object.entries(totals).forEach(([cat,amt])=>{
    const pct = (amt / grand) * 100;
    const seg = document.createElement('div');
    seg.className = 'seg';
    seg.style.width = pct.toFixed(1) + '%';
    seg.style.background = (CATS[cat] && CATS[cat].color) ? CATS[cat].color : '#999';
    seg.textContent = pct > 7 ? Math.round(pct) + '%' : '';
    catbar.appendChild(seg);

    const item = document.createElement('div');
    item.className = 'item';
    item.innerHTML = `<div class="dot" style="background:${(CATS[cat] && CATS[cat].color) ? CATS[cat].color : '#999'}"></div>${cat}
      <span class="amt">${amt.toLocaleString()}원 · ${pct.toFixed(0)}%</span>`;
    legend.appendChild(item);
  });

  const processedCats = ["음료","과자·디저트","조미료·당류","즉석식품·면류","육가공품"];
  const processedTotal = processedCats.reduce((s,c)=>s + (totals[c] || 0), 0);
  window.__processedPct = grand ? Math.round(processedTotal / grand * 100) : 0;
  const insightEl = document.getElementById('catInsight');
  if(insightEl){
    insightEl.innerHTML =
      `이번 구매에서는 <b>가공식품·고당류/고나트륨 카테고리</b>가 식비의 <b>${window.__processedPct}%</b>(${processedTotal.toLocaleString()}원)를 차지하고,
       신선식품은 ${100-window.__processedPct}%에 그쳐요. 매달 이 비율이 쌓이면 소비 패턴 변화를 추적할 수 있어요.`;
  }
})();

// trend chart
let monthsData = [
  {lab:"4월", processed:78}, {lab:"5월", processed:74}, {lab:"6월", processed:69}, {lab:"7월(이번)", processed:null},
];
function renderTrend(){
  const chart = document.getElementById('trendChart');
  if(!chart) return;
  chart.innerHTML = '';
  monthsData.forEach(m=>{
    const col = document.createElement('div');
    col.className = 'month-col';
    col.innerHTML = `
      <div class="month-bar">
        <div class="seg processed" style="height:${m.processed}%"></div>
        <div class="seg fresh" style="height:${100-m.processed}%"></div>
      </div>
      <div class="month-pct">${m.processed}%</div>
      <div class="month-lab">${m.lab}</div>`;
    chart.appendChild(col);
  });
}
function addMonth(){
  const labInput = document.getElementById('newMonthLabel');
  const pctInput = document.getElementById('newMonthPct');
  const lab = labInput.value.trim();
  const pct = Number(pctInput.value);
  if(!lab || isNaN(pct) || pct<0 || pct>100){ alert('달 이름과 0~100 사이의 가공식품 비중(%)을 입력해주세요.'); return; }
  monthsData.push({lab, processed:pct});
  if(monthsData.length>6) monthsData.shift();
  renderTrend();
  labInput.value=''; pctInput.value='';
}
setTimeout(()=>{ monthsData[3].processed = window.__processedPct || 0; renderTrend(); }, 0);

// helpers
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

// 분석 실행
async function runAnalysis(){
  const btn = document.getElementById('analyzeBtn');
  if(btn){ btn.disabled = true; btn.textContent = '분석 중...'; }
  let highCount = 0;

  for(let i=0;i<ITEMS.length;i++){
    const el = document.getElementById('line'+i);
    if(el) el.classList.add('active');
    await sleep(380);
    if(el) el.classList.remove('active');
    const {level,tag} = classify(ITEMS[i]);
    if(el) el.classList.add('flag-'+level, 'done');
    if(el && el.querySelector('.tag')) el.querySelector('.tag').textContent = tag;
    if(level==='high') highCount++;
  }

  await sleep(200);
  const stamp = document.getElementById('stamp');
  if(stamp) stamp.classList.add('show');
  if(stamp){
    if(highCount===0){ stamp.classList.add('safe'); stamp.innerHTML = '위험 품목 없음<small>ALL CLEAR</small>'; }
    else { stamp.classList.remove('safe'); stamp.innerHTML = '대사 위험군<small>METABOLIC RISK</small>'; }
  }

  // 안전한 합산
  const sugarOneEach = ITEMS.reduce((sum, it) => sum + (it && it.perServing && Number(it.perServing.sugar || 0)), 0);
  const sodiumOneEach = ITEMS.reduce((sum, it) => sum + (it && it.perServing && Number(it.perServing.sodium || 0)), 0);

  const DAILY_SUGAR = 50, DAILY_SODIUM = 2000;
  const mSugarEl = document.getElementById('mSugar');
  const mSodiumEl = document.getElementById('mSodium');
  if(mSugarEl) mSugarEl.textContent = Math.round(sugarOneEach/DAILY_SUGAR*100)+'%';
  if(mSodiumEl) mSodiumEl.textContent = Math.round(sodiumOneEach/DAILY_SODIUM*100)+'%';

  const swappable = ITEMS.filter(i=>i.swap);
  const costDeltaTotal = swappable.reduce((s,i)=>s + (Number(i.swap.price||0) - Number(i.price||0)), 0);
  const cEl = document.getElementById('mCost');
  if(cEl) cEl.textContent = (costDeltaTotal>=0?'+':'') + costDeltaTotal.toLocaleString()+'원';
  if(cEl && cEl.parentElement){
    cEl.parentElement.classList.remove('green','red');
    cEl.parentElement.classList.add(costDeltaTotal>0?'red':'green');
  }
  const summaryEl = document.getElementById('summary');
  if(summaryEl) summaryEl.style.display='grid';

  const swapArea = document.getElementById('swapArea');
  if(swapArea){
    swapArea.innerHTML = '<div class="swap-header">아래 대체 추천은 "이번에 구매하신 전체 수량" 기준 절감 내역이에요.</div>';
    swappable.forEach((it,idx)=>{
      const costDelta = Number(it.swap.price||0) - Number(it.price||0);
      const costPill = costDelta===0 ? `<span class="pill cost-down">비용 변화 없음</span>`
        : costDelta<0 ? `<span class="pill cost-down">비용 ${Math.abs(costDelta).toLocaleString()}원 절감</span>`
        : `<span class="pill cost-up">비용 ${costDelta.toLocaleString()}원 증가</span>`;
      const sugarPill = it.swap.sugarDelta>0 ? `<span class="pill nutrient">당류 ${it.swap.sugarDelta}g 감소</span>` : '';
      const sodiumPill = it.swap.sodiumDelta>0 ? `<span class="pill nutrient">나트륨 ${it.swap.sodiumDelta}mg 감소</span>` : '';
      const buyBtn = it.swap.buyable ? `<button class="btn small" onclick='openCommerce(${idx})'>🛒 이 상품으로 구매하기</button>` : '';
      const row = document.createElement('div');
      row.className = 'swap';
      row.innerHTML = `
        <div class="row from"><b>${it.brand} ${it.name}</b></div>
        <div class="row"><span class="arrow">→</span> <span class="to"><b>${it.swap.to}</b></span></div>
        <div class="note">${it.swap.note}</div>
        <div class="deltas">${costPill}${sugarPill}${sodiumPill}</div>
        ${buyBtn ? `<div class="row" style="margin-top:8px;">${buyBtn}</div>` : ''}`;
      swapArea.appendChild(row);
      setTimeout(()=>row.classList.add('show'), idx*150);
    });
    window.__swappable = swappable;
  }

  if(btn) btn.textContent = '✓ 분석 완료';
}

// commerce modal
const FEE_RATE = 0.15;
function openCommerce(idx){
  const it = window.__swappable && window.__swappable[idx];
  if(!it) return;
  const fee = Math.round(Number(it.swap.price||0) * FEE_RATE);
  const titleEl = document.getElementById('modalTitle');
  const priceEl = document.getElementById('modalPrice');
  const totalEl = document.getElementById('modalTotal');
  const feeEl = document.getElementById('modalFee');
  if(titleEl) titleEl.textContent = it.swap.to;
  if(priceEl) priceEl.textContent = Number(it.swap.price||0).toLocaleString()+'원';
  if(totalEl) totalEl.textContent = Number(it.swap.price||0).toLocaleString()+'원';
  if(feeEl) feeEl.innerHTML =
    `이 거래로 <b>푸드스펜드</b>는 중개수수료 <b>${FEE_RATE*100}%(${fee.toLocaleString()}원)</b>를 받고,
     나머지 ${(Number(it.swap.price||0)-fee).toLocaleString()}원은 판매 제휴처에 정산돼요.`;
  const modal = document.getElementById('commerceModal');
  if(modal) modal.classList.add('show');
}
function closeModal(){ const m=document.getElementById('commerceModal'); if(m) m.classList.remove('show'); }

// ------------- OCR & Camera (Tesseract.js 필요) ---------------
const fileInput = document.getElementById('receiptInput');
const cameraBtn = document.getElementById('cameraBtn');
const cameraModal = document.getElementById('cameraModal');
const cameraVideo = document.getElementById('cameraVideo');
const captureBtn = document.getElementById('captureBtn');
const previewWrap = document.getElementById('previewWrap');
const previewImg = document.getElementById('previewImg');
const ocrStatus = document.getElementById('ocrStatus');
const parsedLinesEl = document.getElementById('parsedLines');

let cameraStream = null;
let lastImageDataUrl = null;

if(fileInput){
  fileInput.addEventListener('change', (e)=>{
    const f = e.target.files[0];
    if(!f) return;
    const reader = new FileReader();
    reader.onload = (ev) => previewImageAndRunOCR(ev.target.result);
    reader.readAsDataURL(f);
  });
}
if(cameraBtn) cameraBtn.addEventListener('click', openCamera);
if(captureBtn) captureBtn.addEventListener('click', capturePhoto);

async function openCamera(){
  if(!cameraModal) return;
  cameraModal.classList.add('show');
  try{
    cameraStream = await navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"}, audio:false});
    if(cameraVideo) cameraVideo.srcObject = cameraStream;
  }catch(err){
    console.error('camera open error', err);
    alert('카메라 접근을 허용해 주세요. (데스크탑에서는 카메라가 없으면 동작하지 않을 수 있습니다)');
    if(cameraModal) cameraModal.classList.remove('show');
  }
}
function closeCamera(){
  if(cameraModal) cameraModal.classList.remove('show');
  if(cameraStream){
    cameraStream.getTracks().forEach(t=>t.stop());
    cameraStream = null;
  }
}
function capturePhoto(){
  if(!cameraStream || !cameraVideo) return;
  const video = cameraVideo;
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video,0,0,canvas.width,canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
  closeCamera();
  previewImageAndRunOCR(dataUrl);
}

async function previewImageAndRunOCR(dataUrl){
  lastImageDataUrl = dataUrl;
  if(previewWrap) previewWrap.style.display = 'flex';
  if(previewImg) previewImg.src = dataUrl;
  if(ocrStatus) ocrStatus.textContent = 'OCR 준비 중...';
  if(parsedLinesEl) parsedLinesEl.style.display = 'none';
  try{
    const text = await runTesseract(dataUrl);
    const parsed = parseOCRText(text);
    showParsedEditor(parsed);
  }catch(err){
    console.error('OCR error', err);
    if(ocrStatus) ocrStatus.textContent = 'OCR 실패';
    alert('OCR 처리 중 오류가 발생했습니다. 콘솔을 확인하세요.');
  }
}

async function runTesseract(imageDataUrl){
  if(ocrStatus) ocrStatus.textContent = 'OCR 진행 중...';
  if(typeof Tesseract === 'undefined') throw new Error('Tesseract.js가 로드되지 않았습니다.');
  const worker = Tesseract.createWorker({
    logger: m => {
      if(m.status && m.progress!=null){
        const pct = Math.round(m.progress*100);
        if(ocrStatus) ocrStatus.textContent = `${m.status} ${pct}%`;
      } else {
        if(ocrStatus) ocrStatus.textContent = m.status || '처리중...';
      }
    }
  });
  await worker.load();
  await worker.loadLanguage('eng'); // 숫자/영문 중심. 한국어 필요 시 'kor'로 변경(데이터 필요)
  await worker.initialize('eng');
  const { data: { text } } = await worker.recognize(imageDataUrl);
  await worker.terminate();
  if(ocrStatus) ocrStatus.textContent = 'OCR 완료';
  return text;
}

// 간단한 OCR 파서: 줄별로 마지막 숫자(가격) 추출
function parseOCRText(fullText){
  const lines = String(fullText || '').split(/\r?\n/).map(l=>l.trim()).filter(l=>l.length>0);
  const parsed = [];
  lines.forEach(line=>{
    const nums = line.match(/[\d,]+/g);
    if(!nums) return;
    const priceRaw = nums[nums.length-1];
    if(priceRaw && priceRaw.replace(/,/g,'').length>=2){
      const price = Number(priceRaw.replace(/,/g,''));
      let name = line.replace(priceRaw, '').replace(/[원\s]+/g,'').trim();
      if(!name) name = '품목';
      parsed.push({name, price});
    }
  });
  if(parsed.length===0 && lines.length>0){
    lines.forEach(l=>parsed.push({name:l, price:0}));
  }
  return parsed;
}

// parsed editor UI
function showParsedEditor(parsedItems){
  if(!parsedLinesEl) return;
  parsedLinesEl.innerHTML = '';
  parsedLinesEl.style.display = 'block';
  parsedItems.forEach(p=>{
    const row = document.createElement('div');
    row.className = 'parsed-row';
    row.innerHTML = `
      <input class="name" value="${escapeHtml(p.name)}" />
      <input class="price" value="${p.price||''}" style="width:100px;text-align:right;" />
      <button class="btn small apply">추가</button>
      <button class="btn small" style="background:#A9A392;">삭제</button>
    `;
    row.querySelector('.apply').addEventListener('click', ()=>{
      const nameVal = row.querySelector('.name').value.trim();
      const priceVal = Number(row.querySelector('.price').value || 0);
      const newItem = {
        brand: 'OCR', name: nameVal, price: priceVal, category: '기타',
        unitsPurchased: 1, unitLabel: '개', servingLabel: '1회',
        perServing: {kcal:0, sugar:0, sodium:0}, swap: null
      };
      ITEMS.push(newItem);
      renderReceiptLines();
      row.remove();
    });
    row.querySelectorAll('.btn')[1].addEventListener('click', ()=>row.remove());
    parsedLinesEl.appendChild(row);
  });

  const controls = document.createElement('div');
  controls.className = 'parsed-controls';
  controls.innerHTML = `
    <button class="btn small" id="applyAll">모두 추가</button>
    <button class="btn small" id="cancelParse" style="background:#A9A392;">취소</button>
  `;
  parsedLinesEl.appendChild(controls);

  document.getElementById('applyAll').addEventListener('click', ()=>{
    const rows = Array.from(parsedLinesEl.querySelectorAll('.parsed-row'));
    rows.forEach(r=>{
      const nameVal = r.querySelector('.name').value.trim();
      const priceVal = Number(r.querySelector('.price').value || 0);
      ITEMS.push({
        brand:'OCR', name:nameVal, price:priceVal, category:'기타',
        unitsPurchased:1, unitLabel:'개', servingLabel:'1회', perServing:{kcal:0,sugar:0,sodium:0}, swap:null
      });
    });
    renderReceiptLines();
    parsedLinesEl.style.display = 'none';
  });

  document.getElementById('cancelParse').addEventListener('click', ()=>{
    parsedLinesEl.style.display = 'none';
  });
}

// 안전한 HTML escape
function escapeHtml(s){ return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }