const CATS = {
  "음료":{color:"#B4653E"}, "과자·디저트":{color:"#C08A2E"}, "조미료·당류":{color:"#A85A4E"},
  "즉석식품·면류":{color:"#8C5A3C"}, "육가공품":{color:"#C4784F"},
  "신선식품(단백질)":{color:"#4C7A5A"}, "신선식품(과일)":{color:"#6E9C6F"},
};

// perServing: 1회 섭취량 기준 영양성분 (총 구매량이 아닌, 실제로 한 번에 먹는 표준량)
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

function classify(item){
  if(item.category.startsWith("신선식품")) return {level:'safe', tag:'✔ 안전(신선식품)'};
  const sugarHigh = Number(document.getElementById('sugarSlider').value);
  const sodiumHigh = Number(document.getElementById('sodiumSlider').value);
  const sugarCaution = sugarHigh*0.4, sodiumCaution = sodiumHigh*0.4;
  const s = item.perServing;
  if(s.sugar>=sugarHigh) return {level:'high', tag:'⚠ 고당류 (1회 섭취 기준)'};
  if(s.sodium>=sodiumHigh) return {level:'high', tag:'⚠ 고나트륨 (1회 섭취 기준)'};
  if(s.sugar>=sugarCaution) return {level:'caution', tag:'△ 당류 주의 (1회 섭취 기준)'};
  if(s.sodium>=sodiumCaution) return {level:'caution', tag:'△ 나트륨 주의 (1회 섭취 기준)'};
  return {level:'safe', tag:'✔ 안전 (1회 섭취 기준)'};
}

function onSliderChange(){
  document.getElementById('sugarVal').textContent = document.getElementById('sugarSlider').value+'g';
  document.getElementById('sodiumVal').textContent = document.getElementById('sodiumSlider').value+'mg';
  let highCount = 0;
  ITEMS.forEach((it,i)=>{
    const el = document.getElementById('line'+i);
    if(!el.classList.contains('done')) return;
    const {level,tag} = classify(it);
    el.classList.remove('flag-high','flag-caution','flag-safe');
    el.classList.add('flag-'+level);
    el.querySelector('.tag').textContent = tag;
    if(level==='high') highCount++;
  });
  if(document.getElementById('summary').style.display==='grid'){
    const stamp = document.getElementById('stamp');
    if(highCount>0){ stamp.classList.remove('safe'); stamp.innerHTML = '대사 위험군<small>METABOLIC RISK</small>'; }
    else { stamp.classList.add('safe'); stamp.innerHTML = '위험 품목 없음<small>ALL CLEAR</small>'; }
  }
}

function onHouseholdChange(){
  const h = Number(document.getElementById('householdSlider').value);
  document.getElementById('householdVal').textContent = h+'명';
  ITEMS.forEach((it,i)=>{
    const el = document.querySelector('#line'+i+' .perperson');
    if(!el) return;
    if(it.isBulk){ el.textContent = `조미료류는 가구원수와 무관하게 1회 사용량 기준으로 판단해요`; return; }
    const perPerson = (it.unitsPurchased/h).toFixed(1);
    el.textContent = `👪 ${h}인 가구 기준 1인당 약 ${perPerson}${it.unitLabel.replace(/\(.*\)/,'')}분`;
  });
}

const STAGES = [{n:1,lab:"이커머스 마이데이터"},{n:2,lab:"유통사 전자영수증"},{n:3,lab:"동네마트 OCR"}];
const activeStage = 2;
const pipelineEl = document.getElementById('pipeline');
STAGES.forEach(s=>{
  const div = document.createElement('div');
  div.className = 'step' + (s.n<activeStage?' done':'') + (s.n===activeStage?' active':'');
  div.innerHTML = `<div class="dot">${s.n<activeStage?'✓':s.n}</div><div class="lab">${s.lab}</div>`;
  pipelineEl.appendChild(div);
});

const linesEl = document.getElementById('lines');
ITEMS.forEach((it,i)=>{
  const div = document.createElement('div');
  div.className = 'rline'; div.id = 'line'+i;
  div.innerHTML = `<div class="brand">${it.brand}</div><div class="name">${it.name}</div>
    <div class="price">${it.price.toLocaleString()}원</div>
    <div class="qty">${it.unitsPurchased}${it.unitLabel} · 1회 섭취 기준 ${it.servingLabel}</div>
    <div class="perperson"></div>
    <div class="tag"></div>`;
  linesEl.appendChild(div);
});
document.getElementById('totalPrice').textContent = ITEMS.reduce((s,i)=>s+i.price,0).toLocaleString()+'원';
onHouseholdChange();

(function buildLedger(){
  const totals = {};
  ITEMS.forEach(it=>{ totals[it.category] = (totals[it.category]||0) + it.price; });
  const grand = Object.values(totals).reduce((a,b)=>a+b,0);
  const catbar = document.getElementById('catbar');
  const legend = document.getElementById('catlegend');
  Object.entries(totals).forEach(([cat,amt])=>{
    const pct = amt/grand*100;
    const seg = document.createElement('div');
    seg.className='seg'; seg.style.width = pct.toFixed(1)+'%'; seg.style.background = CATS[cat].color;
    seg.textContent = pct>7 ? Math.round(pct)+'%' : '';
    catbar.appendChild(seg);
    const item = document.createElement('div');
    item.className='item';
    item.innerHTML = `<div class="dot" style="background:${CATS[cat].color}"></div>${cat}
      <span class="amt">${amt.toLocaleString()}원 · ${pct.toFixed(0)}%</span>`;
    legend.appendChild(item);
  });
  const processedCats = ["음료","과자·디저트","조미료·당류","즉석식품·면류","육가공품"];
  const processedTotal = processedCats.reduce((s,c)=>s+(totals[c]||0),0);
  window.__processedPct = Math.round(processedTotal/grand*100);
  document.getElementById('catInsight').innerHTML =
    `이번 구매에서는 <b>가공식품·고당류/고나트륨 카테고리</b>가 식비의 <b>${window.__processedPct}%</b>(${processedTotal.toLocaleString()}원)를 차지하고,
     신선식품은 ${100-window.__processedPct}%에 그쳐요. 매달 이 비율이 쌓이면 소비 패턴 변화를 추적할 수 있어요.`;
})();

let monthsData = [
  {lab:"4월", processed:78}, {lab:"5월", processed:74}, {lab:"6월", processed:69}, {lab:"7월(이번)", processed:null},
];
function renderTrend(){
  const chart = document.getElementById('trendChart');
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
setTimeout(()=>{ monthsData[3].processed = window.__processedPct; renderTrend(); }, 0);

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function runAnalysis(){
  const btn = document.getElementById('analyzeBtn');
  btn.disabled = true; btn.textContent = '분석 중...';
  let highCount = 0;

  for(let i=0;i<ITEMS.length;i++){
    const el = document.getElementById('line'+i);
    el.classList.add('active');
    await sleep(380);
    el.classList.remove('active');
    const {level,tag} = classify(ITEMS[i]);
    el.classList.add('flag-'+level, 'done');
    el.querySelector('.tag').textContent = tag;
    if(level==='high') highCount++;
  }

  await sleep(200);
  const stamp = document.getElementById('stamp');
  stamp.classList.add('show');
  if(highCount===0){ stamp.classList.add('safe'); stamp.innerHTML = '위험 품목 없음<small>ALL CLEAR</small>'; }
  else { stamp.classList.remove('safe'); stamp.innerHTML = '대사 위험군<small>METABOLIC RISK</small>'; }

  // "품목당 1회씩 다 먹는다면" 하루 권장량 대비 — 총 구매량이 아닌 1회 섭취량 합산
  const DAILY_SUGAR = 50, DAILY_SODIUM = 2000;
  const sugarOneEach = ITEMS.reduce((s,i)=>s+i.perServing.sugar,0);
  const sodiumOneEach = ITEMS.reduce((s,i)=>s+i.perServing.sodium,0);
  document.getElementById('mSugar').textContent = Math.round(sugarOneEach/DAILY_SUGAR*100)+'%';
  document.getElementById('mSodium').textContent = Math.round(sodiumOneEach/DAILY_SODIUM*100)+'%';

  const swappable = ITEMS.filter(i=>i.swap);
  const costDeltaTotal = swappable.reduce((s,i)=>s+(i.swap.price-i.price),0);
  const cEl = document.getElementById('mCost');
  cEl.textContent = (costDeltaTotal>=0?'+':'') + costDeltaTotal.toLocaleString()+'원';
  cEl.parentElement.classList.remove('green','red');
  cEl.parentElement.classList.add(costDeltaTotal>0?'red':'green');
  document.getElementById('summary').style.display='grid';

  const swapArea = document.getElementById('swapArea');
  swapArea.innerHTML = '<div class="swap-header">아래 대체 추천은 "이번에 구매하신 전체 수량" 기준 절감 내역이에요.</div>';
  swappable.forEach((it,idx)=>{
    const costDelta = it.swap.price - it.price;
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

  btn.textContent = '✓ 분석 완료';
}

const FEE_RATE = 0.15;
function openCommerce(idx){
  const it = window.__swappable[idx];
  const fee = Math.round(it.swap.price * FEE_RATE);
  document.getElementById('modalTitle').textContent = it.swap.to;
  document.getElementById('modalPrice').textContent = it.swap.price.toLocaleString()+'원';
  document.getElementById('modalTotal').textContent = it.swap.price.toLocaleString()+'원';
  document.getElementById('modalFee').innerHTML =
    `이 거래로 <b>푸드스펜드</b>는 중개수수료 <b>${FEE_RATE*100}%(${fee.toLocaleString()}원)</b>를 받고,
     나머지 ${(it.swap.price-fee).toLocaleString()}원은 판매 제휴처에 정산돼요.`;
  document.getElementById('commerceModal').classList.add('show');
}
function closeModal(){ document.getElementById('commerceModal').classList.remove('show'); }
