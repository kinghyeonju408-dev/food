// ================= 일일호프 POS =================
// 안주 / 주류-음료 메뉴, 테이블 1~22 (1층 1~10, 지하1층 11~22)

const MENU = {
  anju:  { label: "안주",        emoji: "🍢",
    items: [
      { name: "짜파게티 감바스", price: 12000, stock: 40 },
      { name: "신라면 볶음밥",   price: 8000,  stock: 50 },
      { name: "김치 어묵탕",     price: 7000,  stock: 40 },
      { name: "불닭냉면",       price: 7000,  stock: 40 },
      { name: "마른안주 플레터", price: 9000,  stock: 40 },
      { name: "프렌치 토스트",   price: 6000,  stock: 45 },
      { name: "옥수수전",       price: 7500,  stock: 40 },
      { name: "쏘야",           price: 7500,  stock: 50 },
    ] },
  drink: { label: "주류 및 음료", emoji: "🍻",
    items: [
      { name: "소주",           price: 5000, stock: Infinity },
      { name: "맥주",           price: 5000, stock: Infinity },
      { name: "메롱주",         price: 5000, stock: 30 },
      { name: "봉알주",         price: 4500, stock: 30 },
      { name: "요쏘",           price: 4500, stock: 30 },
      { name: "황도소다 하이볼", price: 5000, stock: 30 },
      { name: "콜라",           price: 3000, stock: Infinity },
      { name: "제로콜라",       price: 3000, stock: Infinity },
      { name: "사이다",         price: 3000, stock: Infinity },
    ] },
};

// 테이블 선택 후 나오는 "쿠폰 서비스"는 안주+주류를 합친 목록에서 고름
const ALL_ITEMS = [...MENU.anju.items, ...MENU.drink.items];
const SERVICE_CATS = {
  coupon: { label: "쿠폰 서비스", emoji: "🎟️" },
};
function isServiceCat(cat) { return cat === "coupon"; }

// 주방 현황판: 주방에서 직접 만들 필요 없는 메뉴는 제외, 안주 먼저 → 주류 순서로 고정 정렬
const KITCHEN_EXCLUDED = new Set(["소주", "맥주", "콜라", "제로콜라", "사이다"]);
const KITCHEN_ORDER = ALL_ITEMS.map((it) => it.name).filter((name) => !KITCHEN_EXCLUDED.has(name));

// 메뉴명 -> 가격 / 카테고리 / 초기 재고 조회용
const PRICE = {};
const ITEM_CAT = {};
const INITIAL_STOCK = {};
Object.values(MENU).forEach((cat) => cat.items.forEach((it) => {
  PRICE[it.name] = it.price; ITEM_CAT[it.name] = cat.label; INITIAL_STOCK[it.name] = it.stock;
}));

const TABLE_COUNT = 22;
const FIRST_FLOOR_MAX = 10; // 1~10: 1층, 11~22: 지하1층

// ---------------- 상태 ----------------
let screen = "home";
let currentCat = null;
let currentTable = null;
let cart = {};              // { 메뉴명: 수량 }
let cartService = {};       // { 메뉴명: null|"coupon" } — 담을 당시 어떤 카테고리였는지(유료/서비스 구분)

let modalMode = "add";      // "add" | "refund"
let modalItem = null;       // add 모드에서 선택한 메뉴명
let modalQty = 1;
let refundCtx = null;       // { orderId, itemName, unitPrice, maxQty }

let openDetailTable = null; // 상세 시트가 열려 있는 테이블 번호
let tickTimer = null;

let ordersCache = [];       // 주문(type:"order") + 환불(type:"refund") 문서 목록
let tablesCache = {};       // { "5": {currentBatch, settlements:[{batch, settledAt}]} }
let waitingCache = [];      // [{id, name, partySize, phone, createdAt}]
let manualSoldOut = {};     // { 메뉴명: true } — 주방팀이 직접 표시한 "진짜 품절"

const OVERTIME_MINUTES = 120; // 첫 주문 후 이 시간이 지나면 테이블이 빨간색으로 표시됨

// ---------------- 유틸 ----------------
function fmtTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "--:--";
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
}
function fmtDateTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "-";
  return d.toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}
function fmtWon(n) { return "₩" + Math.round(n || 0).toLocaleString("ko-KR"); }
function elapsedMinutes(iso) {
  const start = new Date(iso).getTime();
  if (isNaN(start)) return 0;
  return Math.max(0, (Date.now() - start) / 60000);
}
function fmtElapsed(iso) {
  const mins = Math.round(elapsedMinutes(iso));
  if (mins < 60) return `${mins}분`;
  return `${Math.floor(mins / 60)}시간 ${mins % 60}분`;
}
function orderAmount(order) {
  if (order && order.amount != null) return Number(order.amount);
  return (order && order.items || []).reduce((s, it) => s + (Number(it.price || 0) * Number(it.qty || 0)), 0);
}
function refundedQtyFor(orderId, itemName) {
  return ordersCache
    .filter((o) => o.type === "refund" && o.refundOf === orderId)
    .reduce((s, r) => s + (r.items || []).filter((it) => it.name === itemName).reduce((s2, it) => s2 + Number(it.qty || 0), 0), 0);
}

// ---------------- 재고 ----------------
// 소진량 = 실제 나간 주문(쿠폰/친구 서비스 포함) - 환불로 돌아온 수량
function consumedQty(name) {
  let sold = 0, refunded = 0;
  ordersCache.forEach((o) => {
    (o.items || []).forEach((it) => {
      if (it.name !== name) return;
      if (o.type === "order") sold += Number(it.qty || 0);
      else if (o.type === "refund") refunded += Number(it.qty || 0);
    });
  });
  return Math.max(0, sold - refunded);
}
function remainingStock(name) {
  const initial = INITIAL_STOCK[name];
  if (initial === Infinity || initial == null) return Infinity;
  return initial - consumedQty(name);
}
function isHardSoldOut(name) { return !!manualSoldOut[name]; }
function fmtStock(remaining) { return remaining === Infinity ? "무제한" : `${remaining}개`; }

let toastTimer = null;
function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2400);
}

function setSyncDot(mode) {
  const dot = document.getElementById("syncDot");
  dot.classList.remove("live", "local");
  if (mode === "live") { dot.classList.add("live"); dot.title = "실시간 동기화 연결됨 (모든 기기에 공유돼요)"; }
  else if (mode === "local") { dot.classList.add("local"); dot.title = "서버 연결 끊김 — 잠시 후 다시 시도해요"; }
  else { dot.title = "연결 확인 중..."; }
}

// ---------------- 서버 API (REST + 폴링) ----------------
const API_BASE = "/api";
async function apiGet(path) {
  const res = await fetch(API_BASE + path);
  if (!res.ok) throw new Error("GET " + path + " failed");
  return res.json();
}
async function apiSend(method, path, body) {
  const res = await fetch(API_BASE + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(method + " " + path + " failed");
  return res.json().catch(() => ({}));
}
async function fetchState() {
  try {
    const state = await apiGet("/state");
    ordersCache = state.orders || [];
    tablesCache = state.tables || {};
    waitingCache = state.waiting || [];
    manualSoldOut = (state.soldout && state.soldout.items) || {};
    setSyncDot("live");
    refreshDataScreens();
  } catch (e) {
    console.error("서버 동기화 실패", e);
    setSyncDot("local");
  }
}
function refreshDataScreens() {
  renderRecords();
  renderLedger();
  renderKitchenBoard();
  renderStockPanel();
  renderWaitingList();
  updateWaitingBadge();
  if (openDetailTable) renderTableDetail();
  if (screen === "menu") renderMenu();
}

// ---------------- 화면 전환 ----------------
function setScreen(name) {
  screen = name;
  document.querySelectorAll(".screen").forEach((el) => { el.hidden = el.id !== "screen-" + name; });
  document.getElementById("backBtn").hidden = name === "home";
  document.getElementById("waitingBtn").hidden = name !== "home";
  document.getElementById("navRecordsBtn").hidden = name === "records" || name === "category" || name === "menu" || name === "waiting";
  document.getElementById("navLedgerBtn").hidden = name === "ledger" || name === "category" || name === "menu" || name === "waiting";
  document.getElementById("cartBar").hidden = !((name === "menu" || name === "category") && Object.keys(cart).length > 0);

  clearInterval(tickTimer);
  if (name === "records") { tickTimer = setInterval(renderRecords, 30000); }
  else if (name === "waiting") { tickTimer = setInterval(renderWaitingList, 30000); }
}

function showHome() { currentCat = null; currentTable = null; cart = {}; cartService = {}; setScreen("home"); renderHomeTables(); }
function selectTable(n) { currentTable = n; currentCat = null; setScreen("category"); renderCategoryScreen(); }
function showMenu(cat) { currentCat = cat; setScreen("menu"); renderMenu(); }
function showRecords() { setScreen("records"); renderRecords(); }
function showLedger() { setScreen("ledger"); renderLedger(); renderKitchenBoard(); renderStockPanel(); }
function showWaiting() { setScreen("waiting"); renderWaitingList(); }

function onBack() {
  if (screen === "category") showHome();
  else if (screen === "menu") { currentCat = null; setScreen("category"); renderCategoryScreen(); }
  else if (screen === "records") showHome();
  else if (screen === "ledger") showHome();
  else if (screen === "waiting") showHome();
}

// ---------------- 홈: 테이블 선택 화면 ----------------
function renderHomeTables() {
  const g1 = document.getElementById("tableGrid1F"); g1.innerHTML = "";
  const g2 = document.getElementById("tableGridB1"); g2.innerHTML = "";
  for (let n = 1; n <= TABLE_COUNT; n++) {
    const btn = document.createElement("button");
    btn.className = "table-btn";
    btn.innerHTML = `${n}<span class="lab">테이블</span>`;
    btn.addEventListener("click", () => selectTable(n));
    (n <= FIRST_FLOOR_MAX ? g1 : g2).appendChild(btn);
  }
}

// ---------------- 카테고리 선택 화면 ----------------
function renderCategoryScreen() {
  document.getElementById("categoryContext").innerHTML =
    `<span class="context-pill on">🍽 테이블 ${currentTable}</span><span class="context-pill">안주·주류를 모두 담아 한 번에 주문할 수 있어요</span>`;
  renderCartBar();
}

// ---------------- 메뉴 & 장바구니 화면 ----------------
function renderMenu() {
  const isService = isServiceCat(currentCat);
  const catInfo = isService ? SERVICE_CATS[currentCat] : MENU[currentCat];
  document.getElementById("menuContext").innerHTML =
    `<span class="context-pill on">${catInfo.emoji} ${catInfo.label}</span><span class="context-pill on">🍽 테이블 ${currentTable}</span>`;

  const items = isService ? ALL_ITEMS : MENU[currentCat].items;
  const grid = document.getElementById("menuGrid");
  grid.innerHTML = "";
  items.forEach(({ name, price }) => {
    const remaining = remainingStock(name);
    const hard = isHardSoldOut(name);
    const soft = !hard && remaining <= 0;
    const lowStock = remaining !== Infinity && remaining <= 10;

    const btn = document.createElement("button");
    btn.className = "menu-item" + (hard ? " hard-soldout" : "");
    btn.disabled = hard;

    if (isService) {
      btn.innerHTML = `
        <span class="mi-name">${name}</span>
        <span class="mi-price mono"><span class="mi-price-orig">${fmtWon(price)}</span> → <span class="mi-price-free-tag">무료</span></span>
        <span class="mi-stock mono${lowStock ? " low" : ""}">재고 ${fmtStock(remaining)}</span>
        ${hard ? `<span class="mi-soldout">품절</span>` : ""}`;
    } else {
      btn.innerHTML = `
        <span class="mi-name">${name}</span>
        <span class="mi-price mono">${fmtWon(price)}</span>
        <span class="mi-stock mono${lowStock ? " low" : ""}">재고 ${fmtStock(remaining)}</span>
        ${(hard || soft) ? `<span class="mi-soldout">품절</span>` : ""}`;
    }

    const qty = cart[name];
    if (qty) {
      const badge = document.createElement("span");
      badge.className = "qty-badge";
      badge.textContent = qty;
      btn.appendChild(badge);
    }
    if (!hard) btn.addEventListener("click", () => openQtyModal(name));
    grid.appendChild(btn);
  });
  renderCartBar();
}

// ---------------- 수량 모달 (담기 / 환불 공용) ----------------
function openQtyModal(name) {
  modalMode = "add";
  modalItem = name;
  refundCtx = null;
  modalQty = 1;
  document.getElementById("qtyName").textContent = name;
  document.getElementById("qtyNum").textContent = modalQty;
  document.getElementById("qtyAddBtn").textContent = "장바구니 담기";
  document.getElementById("qtyAddBtn").classList.remove("btn-refund");
  document.getElementById("qtySubtotal").classList.remove("neg");
  updateQtySubtotal();
  document.getElementById("qtyModal").hidden = false;
}
function openRefundModal(order, itemName, maxQty) {
  if (maxQty <= 0) return;
  modalMode = "refund";
  modalItem = itemName;
  const srcItem = (order.items || []).find((it) => it.name === itemName) || {};
  refundCtx = { orderId: order.id, itemName, unitPrice: Number(srcItem.price != null ? srcItem.price : (PRICE[itemName] || 0)), maxQty };
  modalQty = 1;
  document.getElementById("qtyName").textContent = `${itemName} 환불 (테이블 ${order.tableNum})`;
  document.getElementById("qtyNum").textContent = modalQty;
  document.getElementById("qtyAddBtn").textContent = "환불 처리";
  document.getElementById("qtyAddBtn").classList.add("btn-refund");
  document.getElementById("qtySubtotal").classList.add("neg");
  updateQtySubtotal();
  document.getElementById("qtyModal").hidden = false;
}
function closeQtyModal() {
  document.getElementById("qtyModal").hidden = true;
  modalItem = null;
  refundCtx = null;
}
function currentModalMax() { return modalMode === "refund" ? (refundCtx ? refundCtx.maxQty : 1) : 99; }
function currentModalPrice() { return modalMode === "refund" ? (refundCtx ? refundCtx.unitPrice : 0) : (PRICE[modalItem] || 0); }
function updateQtySubtotal() {
  const price = currentModalPrice();
  const el = document.getElementById("qtySubtotal");
  if (modalMode === "add" && isServiceCat(currentCat)) {
    el.textContent = `무료 서비스 × ${modalQty}  (원가 ${fmtWon(price * modalQty)})`;
    return;
  }
  const sign = modalMode === "refund" ? "-" : "";
  el.textContent = `${fmtWon(price)} × ${modalQty} = ${sign}${fmtWon(price * modalQty)}`;
}
function stepQty(delta) {
  modalQty = Math.max(1, Math.min(currentModalMax(), modalQty + delta));
  document.getElementById("qtyNum").textContent = modalQty;
  updateQtySubtotal();
}
function confirmModalAction() {
  if (modalMode === "refund") submitRefund();
  else addModalToCart();
}
function addModalToCart() {
  if (!modalItem) return;
  cart[modalItem] = (cart[modalItem] || 0) + modalQty;
  cartService[modalItem] = isServiceCat(currentCat) ? currentCat : null;
  closeQtyModal();
  renderMenu();
}

function renderCartBar() {
  const bar = document.getElementById("cartBar");
  const entries = Object.entries(cart);
  if (!(screen === "menu" || screen === "category") || entries.length === 0) { bar.hidden = true; return; }
  bar.hidden = false;

  const chips = document.getElementById("cartChips");
  chips.innerHTML = "";
  let totalQty = 0, totalAmount = 0;
  entries.forEach(([name, qty]) => {
    totalQty += qty;
    const svc = cartService[name];
    const price = svc ? 0 : (PRICE[name] || 0);
    totalAmount += price * qty;
    const chip = document.createElement("div");
    chip.className = "cart-chip";
    const svcTag = svc ? `<span class="chip-service ${svc}">${SERVICE_CATS[svc].emoji}</span>` : "";
    chip.innerHTML = `<span>${svcTag}${name} <span class="n">×${qty}</span></span>`;
    const rm = document.createElement("button");
    rm.textContent = "✕";
    rm.addEventListener("click", () => { delete cart[name]; delete cartService[name]; refreshCartUI(); });
    chip.appendChild(rm);
    chips.appendChild(chip);
  });
  document.getElementById("cartConfirmBtn").textContent = `주문 확정하기 (${totalQty}개 · ${fmtWon(totalAmount)})`;
}
function refreshCartUI() { if (screen === "menu") renderMenu(); else renderCartBar(); }
function clearCart() { cart = {}; cartService = {}; refreshCartUI(); }

async function submitOrder() {
  const names = Object.keys(cart);
  if (names.length === 0 || !currentTable) return;

  const confirmBtn = document.getElementById("cartConfirmBtn");
  confirmBtn.disabled = true;

  const batch = (tablesCache[String(currentTable)] && tablesCache[String(currentTable)].currentBatch) || 1;
  const now = new Date().toISOString();

  // 담을 당시 태그(cartService)에 따라 유료/쿠폰 서비스로 나눠서 각각 별도 주문으로 전송
  const groups = { paid: [], coupon: [] };
  names.forEach((name) => {
    const svc = cartService[name] || "paid";
    groups[svc].push({ name, qty: cart[name] });
  });

  const orders = [];
  if (groups.paid.length > 0) {
    const items = groups.paid.map(({ name, qty }) => ({ name, qty, price: PRICE[name] || 0, cat: ITEM_CAT[name] }));
    orders.push({
      type: "order",
      tableNum: currentTable,
      category: [...new Set(items.map((it) => it.cat))].join(" · "),
      service: null,
      items,
      amount: items.reduce((s, it) => s + it.price * it.qty, 0),
      compValue: 0,
      createdAt: now,
      batch,
    });
  }
  ["coupon"].forEach((svc) => {
    if (groups[svc].length === 0) return;
    const items = groups[svc].map(({ name, qty }) => ({ name, qty, price: 0, cat: ITEM_CAT[name] }));
    orders.push({
      type: "order",
      tableNum: currentTable,
      category: SERVICE_CATS[svc].label,
      service: svc,
      items,
      amount: 0,
      compValue: groups[svc].reduce((s, { name, qty }) => s + (PRICE[name] || 0) * qty, 0),
      createdAt: now,
      batch,
    });
  });

  orders.forEach((order) => {
    order.id = "local-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7);
  });

  try {
    await Promise.all(orders.map((order) => apiSend("POST", "/orders", order)));
    ordersCache.push(...orders);
    refreshDataScreens();
    const tableJustOrdered = currentTable;
    cart = {};
    cartService = {};
    showToast(`테이블 ${tableJustOrdered}번 주문이 주방으로 전달됐어요 🍳`);
    showHome();
  } catch (e) {
    console.error("주문 전송 실패", e);
    showToast("주문 전송에 실패했어요. 다시 시도해주세요.");
  } finally {
    confirmBtn.disabled = false;
  }
}

async function submitRefund() {
  if (!refundCtx) return;
  const order = ordersCache.find((o) => o.id === refundCtx.orderId);
  if (!order) { showToast("원래 주문을 찾을 수 없어요. 새로고침 후 다시 시도해주세요."); return; }

  const orderedQty = ((order.items || []).find((it) => it.name === refundCtx.itemName) || {}).qty || 0;
  const freshRemaining = Math.max(0, orderedQty - refundedQtyFor(order.id, refundCtx.itemName));
  if (freshRemaining <= 0) { showToast("이미 다른 곳에서 환불 처리됐어요."); closeQtyModal(); return; }

  const addBtn = document.getElementById("qtyAddBtn");
  addBtn.disabled = true;

  const qty = Math.min(modalQty, freshRemaining);
  const refundDoc = {
    type: "refund",
    tableNum: order.tableNum,
    category: ITEM_CAT[refundCtx.itemName] || order.category,
    items: [{ name: refundCtx.itemName, qty, price: refundCtx.unitPrice, cat: ITEM_CAT[refundCtx.itemName] }],
    amount: -(refundCtx.unitPrice * qty),
    createdAt: new Date().toISOString(),
    batch: order.batch,
    refundOf: order.id,
  };

  refundDoc.id = "local-refund-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7);

  try {
    await apiSend("POST", "/orders", refundDoc);
    ordersCache.push(refundDoc);
    refreshDataScreens();
    showToast(`환불 처리했어요. (${refundCtx.itemName} ×${qty})`);
    closeQtyModal();
  } catch (e) {
    console.error("환불 처리 실패", e);
    showToast("환불 처리에 실패했어요. 다시 시도해주세요.");
  } finally {
    addBtn.disabled = false;
  }
}

// ---------------- 테이블별 주문 화면 (한눈에 보기) ----------------
function ordersForTable(n) {
  return ordersCache.filter((o) => Number(o.tableNum) === n);
}

function renderRecords() {
  if (screen !== "records") return;
  const g1 = document.getElementById("recordGrid1F"); g1.innerHTML = "";
  const g2 = document.getElementById("recordGridB1"); g2.innerHTML = "";

  for (let n = 1; n <= TABLE_COUNT; n++) {
    const floor = n <= FIRST_FLOOR_MAX ? "1층" : "지하 1층";
    const tstate = tablesCache[String(n)] || { currentBatch: 1, settlements: [] };
    const openBatch = tstate.currentBatch || 1;
    const openOrders = ordersForTable(n).filter((o) => o.batch === openBatch);
    const openTakenOrders = openOrders.filter((o) => o.type !== "refund").sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));

    const tile = document.createElement("button");
    tile.className = "record-tile " + (openTakenOrders.length > 0 ? "active" : "idle");

    if (openTakenOrders.length > 0) {
      const currentAmount = openOrders.reduce((s, o) => s + orderAmount(o), 0);
      const lastOrder = openTakenOrders[openTakenOrders.length - 1];
      const lastItems = (lastOrder.items || []).map((it) => it.name);
      const recentStr = lastItems.length > 1 ? `${lastItems[0]} 외 ${lastItems.length - 1}건` : (lastItems[0] || "-");
      if (elapsedMinutes(openTakenOrders[0].createdAt) >= OVERTIME_MINUTES) tile.classList.add("overtime");
      tile.innerHTML = `
        <div class="rt-top"><span class="rt-num">${n}</span><span class="rt-floor">${floor}</span></div>
        <div class="rt-recent">${recentStr}</div>
        <div class="rt-elapsed">⏱ 첫 주문 후 ${fmtElapsed(openTakenOrders[0].createdAt)}</div>
        <div class="rt-amount">${fmtWon(currentAmount)}</div>`;
    } else {
      tile.innerHTML = `
        <div class="rt-top"><span class="rt-num">${n}</span><span class="rt-floor">${floor}</span></div>
        <div class="rt-empty">주문 대기중</div>`;
    }
    tile.addEventListener("click", () => openTableDetail(n));
    (n <= FIRST_FLOOR_MAX ? g1 : g2).appendChild(tile);
  }
}

function openTableDetail(n) {
  openDetailTable = n;
  renderTableDetail();
  document.getElementById("tableDetailModal").hidden = false;
}
function closeTableDetail() {
  document.getElementById("tableDetailModal").hidden = true;
  openDetailTable = null;
}

function renderTableDetail() {
  const n = openDetailTable;
  if (!n) return;
  const floor = n <= FIRST_FLOOR_MAX ? "1층" : "지하 1층";
  document.getElementById("detailTitle").textContent = `테이블 ${n} · ${floor}`;

  const tstate = tablesCache[String(n)] || { currentBatch: 1, settlements: [] };
  const myOrders = ordersForTable(n).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));

  const body = document.getElementById("detailBody");
  body.innerHTML = "";

  if (myOrders.length === 0) {
    body.innerHTML = `<div class="order-empty">아직 주문이 없어요</div>`;
  } else {
    let lastBatch = null;
    myOrders.forEach((o) => {
      if (lastBatch !== null && o.batch !== lastBatch) {
        const settleInfo = (tstate.settlements || []).find((s) => s.batch === lastBatch);
        const div = document.createElement("div");
        div.className = "settle-divider";
        div.innerHTML = `<span class="line"></span><span class="tag">💳 계산 완료${settleInfo ? " · " + fmtTime(settleInfo.settledAt) : ""}</span><span class="line"></span>`;
        body.appendChild(div);
      }
      lastBatch = o.batch;

      if (o.type === "refund") {
        const it = (o.items || [])[0] || {};
        const entry = document.createElement("div");
        entry.className = "order-entry refund-entry";
        entry.innerHTML = `<span class="t">${fmtTime(o.createdAt)}</span>↩ 환불 · ${it.name || ""} ×${it.qty || 0}
          <span class="entry-amt neg">${fmtWon(orderAmount(o))}</span>`;
        body.appendChild(entry);
        return;
      }

      const entry = document.createElement("div");
      entry.className = "order-entry";
      const head = document.createElement("div");
      head.className = "oe-head";
      const stage = orderStage(o);
      const svcBadge = o.service
        ? `<span class="service-badge ${o.service}">${SERVICE_CATS[o.service].emoji} ${SERVICE_CATS[o.service].label}</span>`
        : `<span class="service-badge paid">💳 유료 주문</span>`;
      head.innerHTML = `<span class="t">${fmtTime(o.createdAt)}</span>${svcBadge}<span class="cat-tag">(${o.category || ""})</span>
        <span class="stage-badge ${stage}">${STAGE_LABEL[stage]}</span>
        <span class="entry-amt">${fmtWon(orderAmount(o))}</span>`;
      entry.appendChild(head);

      const itemsWrap = document.createElement("div");
      itemsWrap.className = "oe-items";
      (o.items || []).forEach((it) => {
        const refunded = refundedQtyFor(o.id, it.name);
        const remaining = Math.max(0, Number(it.qty || 0) - refunded);
        const chip = document.createElement("span");
        chip.className = "item-chip" + (remaining <= 0 ? " refunded" : "");
        const qtyLabel = remaining < it.qty ? `×${remaining} (원래 ×${it.qty})` : `×${it.qty}`;
        chip.innerHTML = `<span>${it.name} ${qtyLabel}</span>`;
        if (remaining > 0) {
          const rbtn = document.createElement("button");
          rbtn.className = "refund-btn";
          rbtn.textContent = "환불";
          rbtn.addEventListener("click", () => openRefundModal(o, it.name, remaining));
          chip.appendChild(rbtn);
        } else {
          const tag = document.createElement("span");
          tag.className = "refunded-tag";
          tag.textContent = "환불완료";
          chip.appendChild(tag);
        }
        itemsWrap.appendChild(chip);
      });
      entry.appendChild(itemsWrap);
      body.appendChild(entry);
    });
  }

  const openBatch = tstate.currentBatch || 1;
  const hasOpen = myOrders.some((o) => o.batch === openBatch && o.type !== "refund");
  const settleBtn = document.createElement("button");
  settleBtn.className = "settle-btn";
  settleBtn.textContent = hasOpen ? "💳 계산 완료 처리" : "정산할 주문 없음";
  settleBtn.disabled = !hasOpen;
  settleBtn.addEventListener("click", () => settleTable(n));
  body.appendChild(settleBtn);
}

async function settleTable(n) {
  const cur = tablesCache[String(n)] || { currentBatch: 1, settlements: [] };
  const openBatch = cur.currentBatch || 1;
  const hasOpenOrders = ordersCache.some((o) => Number(o.tableNum) === n && o.batch === openBatch && o.type !== "refund");
  if (!hasOpenOrders) return;

  const newDoc = {
    currentBatch: openBatch + 1,
    settlements: (cur.settlements || []).concat([{ batch: openBatch, settledAt: new Date().toISOString() }]),
  };

  try {
    await apiSend("PATCH", "/tables/" + n, newDoc);
    tablesCache[String(n)] = newDoc;
    refreshDataScreens();
    showToast(`테이블 ${n}번 계산 완료 처리했어요.`);
  } catch (e) {
    console.error("계산 완료 처리 실패", e);
    showToast("처리에 실패했어요. 다시 시도해주세요.");
  }
}

// ---------------- 정산 시트 (회계용) ----------------
function allOrdersSorted() {
  return ordersCache.slice().sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}
// 3단계 상태: pending(주문 확인 보류중) -> confirmed(주문 확인 완료) -> served(음식 나옴)
function orderStage(o) {
  if (o.servedAt) return "served";
  if (o.confirmedAt) return "confirmed";
  return "pending";
}
const STAGE_LABEL = { pending: "확인 보류중", confirmed: "확인 완료", served: "음식 나옴" };

function renderLedger() {
  if (screen !== "ledger") return;
  const rows = allOrdersSorted();
  const totalAmount = rows.reduce((s, o) => s + orderAmount(o), 0);
  const categoryTotal = (label) => rows.reduce((s, o) => s + (o.items || [])
    .filter((it) => (it.cat || ITEM_CAT[it.name]) === label)
    .reduce((s2, it) => s2 + (o.type === "refund" ? -1 : 1) * Number(it.price || 0) * Number(it.qty || 0), 0), 0);
  const anjuTotal = categoryTotal(MENU.anju.label);
  const drinkTotal = categoryTotal(MENU.drink.label);
  const couponValue = rows.filter((o) => o.service === "coupon").reduce((s, o) => s + Number(o.compValue || 0), 0);
  const tableCount = new Set(rows.filter((o) => o.type === "order").map((o) => Number(o.tableNum))).size;

  document.getElementById("ledgerTableCount").textContent = tableCount + "테이블";
  document.getElementById("ledgerTotal").textContent = fmtWon(totalAmount);
  document.getElementById("ledgerAnju").textContent = fmtWon(anjuTotal);
  document.getElementById("ledgerDrink").textContent = fmtWon(drinkTotal);
  document.getElementById("ledgerCoupon").textContent = fmtWon(couponValue);

  const body = document.getElementById("ledgerBody");
  body.innerHTML = "";
  if (rows.length === 0) {
    body.innerHTML = `<tr><td colspan="8" class="ledger-empty">아직 주문 내역이 없어요</td></tr>`;
    return;
  }
  rows.forEach((o) => {
    const isRefund = o.type === "refund";
    const tr = document.createElement("tr");
    if (isRefund) tr.className = "refund-row";
    const itemsStr = (o.items || []).map((it) => `${it.name} ×${it.qty}`).join(", ");

    const stageTd = document.createElement("td");
    stageTd.className = "stage-cell";
    if (isRefund) {
      stageTd.innerHTML = `<span class="served-na">-</span>`;
    } else {
      const stage = orderStage(o);
      stageTd.innerHTML = `<span class="stage-badge ${stage}">${STAGE_LABEL[stage]}</span>`;
    }
    tr.appendChild(stageTd);

    const confirmTd = document.createElement("td");
    confirmTd.className = "stage-cell";
    if (isRefund) {
      confirmTd.innerHTML = `<span class="served-na">-</span>`;
    } else {
      const cbtn = document.createElement("button");
      cbtn.className = "stage-btn confirm" + (o.confirmedAt ? " on" : "");
      cbtn.textContent = o.confirmedAt ? `✔ 주문확인 · ${fmtTime(o.confirmedAt)}` : "주문 확인";
      cbtn.addEventListener("click", () => toggleConfirmed(o.id, !o.confirmedAt));
      confirmTd.appendChild(cbtn);
    }
    tr.appendChild(confirmTd);

    const servedTd = document.createElement("td");
    servedTd.className = "stage-cell";
    if (isRefund) {
      servedTd.innerHTML = `<span class="served-na">-</span>`;
    } else {
      const sbtn = document.createElement("button");
      sbtn.className = "stage-btn served" + (o.servedAt ? " on" : "");
      sbtn.textContent = o.servedAt ? `🍽 음식나옴 · ${fmtTime(o.servedAt)}` : "음식 준비 완료";
      sbtn.addEventListener("click", () => toggleServed(o.id, !o.servedAt));
      servedTd.appendChild(sbtn);
    }
    tr.appendChild(servedTd);

    tr.insertAdjacentHTML("beforeend", `
      <td class="mono">${fmtDateTime(o.createdAt)}</td>
      <td>테이블 ${o.tableNum}</td>
      <td>${o.category || ""}${isRefund ? " (환불)" : ""}</td>
      <td>${isRefund ? "↩ " : ""}${itemsStr}</td>
      <td class="mono amt">${fmtWon(orderAmount(o))}</td>`);
    body.appendChild(tr);
  });
}

// ---------------- 주방 현황판 (지환용 — 만들어야 할 메뉴 / 완료된 메뉴 한눈에 보기) ----------------
function kitchenAggregates() {
  const todo = {};
  const done = {};
  ordersCache.forEach((o) => {
    if (o.type !== "order") return;
    (o.items || []).forEach((it) => {
      if (KITCHEN_EXCLUDED.has(it.name)) return;
      const refunded = refundedQtyFor(o.id, it.name);
      const remaining = Math.max(0, Number(it.qty || 0) - refunded);
      if (remaining <= 0) return;
      const bucket = o.servedAt ? done : todo;
      bucket[it.name] = (bucket[it.name] || 0) + remaining;
    });
  });
  return { todo, done };
}
function renderKitchenBoard() {
  if (screen !== "ledger") return;
  const { todo, done } = kitchenAggregates();
  const names = KITCHEN_ORDER.filter((name) => (todo[name] || 0) > 0 || (done[name] || 0) > 0);

  const totalTodo = Object.values(todo).reduce((s, n) => s + n, 0);
  const totalDone = Object.values(done).reduce((s, n) => s + n, 0);
  document.getElementById("kbTodoCount").textContent = totalTodo + "개";
  document.getElementById("kbDoneCount").textContent = totalDone + "개";

  const grid = document.getElementById("kbGrid");
  if (names.length === 0) {
    grid.innerHTML = `<div class="kb-empty">아직 들어온 주문이 없어요</div>`;
    return;
  }
  grid.innerHTML = names.map((name) => {
    const t = todo[name] || 0;
    const d = done[name] || 0;
    return `<div class="kb-tile${t > 0 ? " urgent" : ""}">
      <div class="kb-tile-name">${name}</div>
      <div class="kb-tile-nums">
        <span class="kb-num todo">🔥${t}</span>
        <span class="kb-num done">✅${d}</span>
      </div>
    </div>`;
  }).join("");
}

// ---------------- 재고 관리 (정산 시트) ----------------
function renderStockPanel() {
  if (screen !== "ledger") return;
  const grid = document.getElementById("stockGrid");
  grid.innerHTML = "";
  ALL_ITEMS.forEach(({ name }) => {
    const remaining = remainingStock(name);
    const initial = INITIAL_STOCK[name];
    const hard = isHardSoldOut(name);
    const soft = !hard && remaining <= 0;

    const item = document.createElement("div");
    item.className = "stock-item" + (hard ? " hard" : soft ? " soft" : "");
    item.innerHTML = `
      <div class="si-main">
        <span class="si-name">${name}</span>
        <span class="si-qty mono">${initial === Infinity ? "무제한" : `${remaining}/${initial}개`}</span>
      </div>`;
    const btn = document.createElement("button");
    btn.className = "si-toggle" + (hard ? " on" : "");
    btn.textContent = hard ? "품절 해제" : "품절 처리";
    btn.addEventListener("click", () => toggleManualSoldOut(name, !hard));
    item.appendChild(btn);
    grid.appendChild(item);
  });
}

async function toggleManualSoldOut(name, value) {
  try {
    await apiSend("PATCH", "/soldout", { name, value });
    manualSoldOut[name] = value;
    refreshDataScreens();
    showToast(value ? `${name} 품절 처리했어요.` : `${name} 품절을 해제했어요.`);
  } catch (e) {
    console.error("품절 처리 실패", e);
    showToast("처리에 실패했어요. 다시 시도해주세요.");
  }
}

async function toggleConfirmed(orderId, checked) {
  const confirmedAt = checked ? new Date().toISOString() : null;
  try {
    await apiSend("PATCH", "/orders/" + orderId, { confirmedAt });
    const o = ordersCache.find((x) => x.id === orderId);
    if (o) o.confirmedAt = confirmedAt;
    refreshDataScreens();
  } catch (e) {
    console.error("주문 확인 처리 실패", e);
    showToast("처리에 실패했어요. 다시 시도해주세요.");
    renderLedger();
  }
}

async function toggleServed(orderId, checked) {
  const servedAt = checked ? new Date().toISOString() : null;
  try {
    await apiSend("PATCH", "/orders/" + orderId, { servedAt });
    const o = ordersCache.find((x) => x.id === orderId);
    if (o) o.servedAt = servedAt;
    refreshDataScreens();
  } catch (e) {
    console.error("나감 처리 실패", e);
    showToast("처리에 실패했어요. 다시 시도해주세요.");
    renderLedger();
  }
}

async function exportExcel() {
  if (typeof XLSX === "undefined") { showToast("엑셀 기능을 불러오지 못했어요. 새로고침 후 다시 시도해주세요."); return; }
  const rows = allOrdersSorted();
  const totalAmount = rows.reduce((s, o) => s + orderAmount(o), 0);

  const aoa = [["상태", "확인시간", "나간시간", "시간", "테이블", "구분", "주문 내역", "금액"]];
  rows.forEach((o) => {
    const isRefund = o.type === "refund";
    aoa.push([
      isRefund ? "-" : STAGE_LABEL[orderStage(o)],
      o.confirmedAt ? fmtDateTime(o.confirmedAt) : "",
      o.servedAt ? fmtDateTime(o.servedAt) : "",
      fmtDateTime(o.createdAt),
      `테이블 ${o.tableNum}`,
      (o.category || "") + (isRefund ? " (환불)" : ""),
      (isRefund ? "환불: " : "") + (o.items || []).map((it) => `${it.name} x${it.qty}`).join(", "),
      orderAmount(o),
    ]);
  });
  aoa.push([]);
  aoa.push(["", "", "", "", "", "", "총 매출", totalAmount]);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 14 }, { wch: 42 }, { wch: 12 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "주문내역");
  const wbArray = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([wbArray], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });

  const stamp = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const filename = `일일호프_정산_${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}_${pad(stamp.getHours())}${pad(stamp.getMinutes())}.xlsx`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function resetAll() {
  if (!confirm("정말 모든 주문 기록을 초기화할까요? 되돌릴 수 없어요.")) return;
  if (!confirm("한 번 더 확인할게요. 전체 주문 데이터를 삭제합니다. 진행할까요?")) return;
  try {
    await apiSend("POST", "/reset");
    ordersCache = [];
    tablesCache = {};
    waitingCache = [];
    manualSoldOut = {};
    refreshDataScreens();
    showToast("초기화 완료");
  } catch (e) {
    console.error("초기화 실패", e);
    showToast("초기화에 실패했어요.");
  }
}

// ---------------- 웨이팅 ----------------
function updateWaitingBadge() {
  const badge = document.getElementById("waitingBadge");
  if (waitingCache.length > 0) { badge.hidden = false; badge.textContent = waitingCache.length; }
  else { badge.hidden = true; }
}

function renderWaitingList() {
  if (screen !== "waiting") return;
  const rows = waitingCache.slice().sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  document.getElementById("waitingCountBadge").textContent = rows.length + "팀";

  const list = document.getElementById("waitingList");
  list.innerHTML = "";
  if (rows.length === 0) {
    list.innerHTML = `<div class="waiting-empty">현재 대기 중인 팀이 없어요</div>`;
    return;
  }
  rows.forEach((w, i) => {
    const item = document.createElement("div");
    item.className = "waiting-item";
    item.innerHTML = `
      <span class="wi-num">${i + 1}</span>
      <div class="wi-main">
        <span class="wi-name">${w.name}</span>
        <span class="wi-sub">${w.partySize}명 · ${w.phone || "연락처 미입력"}</span>
      </div>
      <span class="wi-elapsed">⏱ ${fmtElapsed(w.createdAt)} 대기중</span>`;
    const rmBtn = document.createElement("button");
    rmBtn.className = "wi-remove";
    rmBtn.textContent = "입장/삭제";
    rmBtn.addEventListener("click", () => removeWaiting(w.id));
    item.appendChild(rmBtn);
    list.appendChild(item);
  });
}

async function addWaiting() {
  const nameEl = document.getElementById("waitName");
  const sizeEl = document.getElementById("waitSize");
  const phoneEl = document.getElementById("waitPhone");
  const name = nameEl.value.trim();
  const partySize = Math.max(1, Number(sizeEl.value) || 1);
  const phone = phoneEl.value.trim();
  if (!name) { showToast("대표자 이름을 입력해주세요."); nameEl.focus(); return; }

  const entry = { name, partySize, phone, createdAt: new Date().toISOString() };
  entry.id = "local-wait-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7);
  try {
    await apiSend("POST", "/waiting", entry);
    waitingCache.push(entry);
    refreshDataScreens();
    nameEl.value = "";
    sizeEl.value = "2";
    phoneEl.value = "";
    nameEl.focus();
    showToast(`${name}님 웨이팅 등록했어요.`);
  } catch (e) {
    console.error("웨이팅 등록 실패", e);
    showToast("웨이팅 등록에 실패했어요. 다시 시도해주세요.");
  }
}

async function removeWaiting(id) {
  try {
    await apiSend("DELETE", "/waiting/" + id);
    waitingCache = waitingCache.filter((w) => w.id !== id);
    refreshDataScreens();
  } catch (e) {
    console.error("웨이팅 삭제 실패", e);
    showToast("처리에 실패했어요. 다시 시도해주세요.");
  }
}

// ---------------- 초기 바인딩 & 부팅 ----------------
function wireStaticUI() {
  document.querySelectorAll(".category-card").forEach((el) => {
    el.addEventListener("click", () => showMenu(el.dataset.cat));
  });
  document.getElementById("backBtn").addEventListener("click", onBack);
  document.getElementById("waitingBtn").addEventListener("click", showWaiting);
  document.getElementById("waitAddBtn").addEventListener("click", addWaiting);
  document.getElementById("navRecordsBtn").addEventListener("click", showRecords);
  document.getElementById("navLedgerBtn").addEventListener("click", showLedger);
  document.getElementById("exportExcelBtn").addEventListener("click", exportExcel);
  document.getElementById("qtyMinus").addEventListener("click", () => stepQty(-1));
  document.getElementById("qtyPlus").addEventListener("click", () => stepQty(1));
  document.getElementById("qtyAddBtn").addEventListener("click", confirmModalAction);
  document.getElementById("qtyCancelBtn").addEventListener("click", closeQtyModal);
  document.getElementById("qtyModal").addEventListener("click", (e) => {
    if (e.target.id === "qtyModal") closeQtyModal();
  });
  document.getElementById("detailCloseBtn").addEventListener("click", closeTableDetail);
  document.getElementById("tableDetailModal").addEventListener("click", (e) => {
    if (e.target.id === "tableDetailModal") closeTableDetail();
  });
  document.getElementById("cartConfirmBtn").addEventListener("click", submitOrder);
  document.getElementById("cartClearBtn").addEventListener("click", clearCart);
  document.getElementById("resetLink").addEventListener("click", resetAll);
}

const POLL_INTERVAL_MS = 3000;

async function boot() {
  setSyncDot("connecting");
  await fetchState();
  setInterval(fetchState, POLL_INTERVAL_MS);
}

wireStaticUI();
setScreen("home");
renderHomeTables();
boot();
