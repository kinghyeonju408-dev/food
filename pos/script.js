// ================= 일일호프 POS =================
// 안주 / 주류-음료 메뉴, 테이블 1~22 (1층 1~10, 지하1층 11~22)

const MENU = {
  anju:  { label: "안주",        emoji: "🍢",
    items: [
      { name: "짜파게티 감바스", price: 12000 },
      { name: "신라면 볶음밥",   price: 8000 },
      { name: "김치 어묵탕",     price: 7000 },
      { name: "불닭냉면",       price: 7000 },
      { name: "마른안주 플레터", price: 9000 },
      { name: "프렌치 토스트",   price: 6000 },
      { name: "옥수수전",       price: 7500 },
      { name: "쏘야",           price: 7500 },
    ] },
  drink: { label: "주류 및 음료", emoji: "🍻",
    items: [
      { name: "소주",           price: 5000 },
      { name: "맥주",           price: 5000 },
      { name: "메롱주",         price: 5000 },
      { name: "봉알주",         price: 4500 },
      { name: "요쏘",           price: 4500 },
      { name: "황도소다 하이볼", price: 5000 },
      { name: "콜라",           price: 2000 },
      { name: "제로콜라",       price: 2000 },
      { name: "사이다",         price: 2000 },
    ] },
};

// 메뉴명 -> 가격 / 카테고리 조회용
const PRICE = {};
const ITEM_CAT = {};
Object.values(MENU).forEach((cat) => cat.items.forEach((it) => { PRICE[it.name] = it.price; ITEM_CAT[it.name] = cat.label; }));

const TABLE_COUNT = 22;
const FIRST_FLOOR_MAX = 10; // 1~10: 1층, 11~22: 지하1층
const inClaudeViewer = !!(window.claude && typeof window.claude.use === "function");
let downloadsApi = null;

// ---------------- 상태 ----------------
let screen = "home";
let currentCat = null;
let currentTable = null;
let cart = {};              // { 메뉴명: 수량 }

let modalMode = "add";      // "add" | "refund"
let modalItem = null;       // add 모드에서 선택한 메뉴명
let modalQty = 1;
let refundCtx = null;       // { orderId, itemName, unitPrice, maxQty }

let openDetailTable = null; // 상세 시트가 열려 있는 테이블 번호
let tickTimer = null;

let appDb = null;           // claude db 네임스페이스 (없으면 로컬 모드)
let ordersCache = [];       // 주문(type:"order") + 환불(type:"refund") 문서 목록
let tablesCache = {};       // { "5": {currentBatch, settlements:[{batch, settledAt}]} }
let waitingCache = [];      // [{id, name, partySize, phone, createdAt}]

const LS_ORDERS = "ilhof_pos_orders";
const LS_TABLES = "ilhof_pos_tables";
const LS_WAITING = "ilhof_pos_waiting";
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
  else if (mode === "local") { dot.classList.add("local"); dot.title = "로컬 전용 모드 — 이 기기에서만 기록돼요"; }
  else { dot.title = "연결 확인 중..."; }
}

// ---------------- 로컬 저장소 폴백 ----------------
function loadLocalData() {
  try { ordersCache = JSON.parse(localStorage.getItem(LS_ORDERS) || "[]"); }
  catch (e) { ordersCache = []; }
  try { tablesCache = JSON.parse(localStorage.getItem(LS_TABLES) || "{}"); }
  catch (e) { tablesCache = {}; }
  try { waitingCache = JSON.parse(localStorage.getItem(LS_WAITING) || "[]"); }
  catch (e) { waitingCache = []; }
  refreshDataScreens();
}
function refreshDataScreens() {
  renderRecords();
  renderLedger();
  renderWaitingList();
  updateWaitingBadge();
  if (openDetailTable) renderTableDetail();
}
function saveLocalData() {
  localStorage.setItem(LS_ORDERS, JSON.stringify(ordersCache));
  localStorage.setItem(LS_TABLES, JSON.stringify(tablesCache));
  localStorage.setItem(LS_WAITING, JSON.stringify(waitingCache));
}
window.addEventListener("storage", (e) => {
  if (!appDb && (e.key === LS_ORDERS || e.key === LS_TABLES || e.key === LS_WAITING)) loadLocalData();
});

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

function showHome() { currentCat = null; currentTable = null; cart = {}; setScreen("home"); renderHomeTables(); }
function selectTable(n) { currentTable = n; currentCat = null; setScreen("category"); renderCategoryScreen(); }
function showMenu(cat) { currentCat = cat; setScreen("menu"); renderMenu(); }
function showRecords() { setScreen("records"); renderRecords(); }
function showLedger() { setScreen("ledger"); renderLedger(); }
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
  const cat = MENU[currentCat];
  document.getElementById("menuContext").innerHTML =
    `<span class="context-pill on">${cat.emoji} ${cat.label}</span><span class="context-pill on">🍽 테이블 ${currentTable}</span>`;

  const grid = document.getElementById("menuGrid");
  grid.innerHTML = "";
  cat.items.forEach(({ name, price }) => {
    const btn = document.createElement("button");
    btn.className = "menu-item";
    btn.innerHTML = `<span class="mi-name">${name}</span><span class="mi-price mono">${fmtWon(price)}</span>`;
    const qty = cart[name];
    if (qty) {
      const badge = document.createElement("span");
      badge.className = "qty-badge";
      badge.textContent = qty;
      btn.appendChild(badge);
    }
    btn.addEventListener("click", () => openQtyModal(name));
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
  const sign = modalMode === "refund" ? "-" : "";
  document.getElementById("qtySubtotal").textContent = `${fmtWon(price)} × ${modalQty} = ${sign}${fmtWon(price * modalQty)}`;
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
    totalAmount += (PRICE[name] || 0) * qty;
    const chip = document.createElement("div");
    chip.className = "cart-chip";
    chip.innerHTML = `<span>${name} <span class="n">×${qty}</span></span>`;
    const rm = document.createElement("button");
    rm.textContent = "✕";
    rm.addEventListener("click", () => { delete cart[name]; refreshCartUI(); });
    chip.appendChild(rm);
    chips.appendChild(chip);
  });
  document.getElementById("cartConfirmBtn").textContent = `주문 확정하기 (${totalQty}개 · ${fmtWon(totalAmount)})`;
}
function refreshCartUI() { if (screen === "menu") renderMenu(); else renderCartBar(); }
function clearCart() { cart = {}; refreshCartUI(); }

async function submitOrder() {
  const items = Object.entries(cart).map(([name, qty]) => ({ name, qty, price: PRICE[name] || 0, cat: ITEM_CAT[name] }));
  if (items.length === 0 || !currentTable) return;

  const confirmBtn = document.getElementById("cartConfirmBtn");
  confirmBtn.disabled = true;

  const batch = (tablesCache[String(currentTable)] && tablesCache[String(currentTable)].currentBatch) || 1;
  const order = {
    type: "order",
    tableNum: currentTable,
    category: [...new Set(items.map((it) => it.cat))].join(" · "),
    items,
    amount: items.reduce((s, it) => s + it.price * it.qty, 0),
    createdAt: new Date().toISOString(),
    batch,
  };

  try {
    if (appDb) {
      await appDb.collection("orders").add(order);
    } else {
      order.id = "local-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7);
      ordersCache.push(order);
      saveLocalData();
      refreshDataScreens();
    }
    const tableJustOrdered = currentTable;
    cart = {};
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

  try {
    if (appDb) {
      await appDb.collection("orders").add(refundDoc);
    } else {
      refundDoc.id = "local-refund-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7);
      ordersCache.push(refundDoc);
      saveLocalData();
      refreshDataScreens();
    }
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
      head.innerHTML = `<span class="t">${fmtTime(o.createdAt)}</span><span class="cat-tag">(${o.category || ""})</span>
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
    if (appDb) {
      await appDb.doc("tables/" + n).set(newDoc);
    } else {
      tablesCache[String(n)] = newDoc;
      saveLocalData();
      refreshDataScreens();
    }
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

  document.getElementById("ledgerCount").textContent = rows.length + "건";
  document.getElementById("ledgerTotal").textContent = fmtWon(totalAmount);
  document.getElementById("ledgerAnju").textContent = fmtWon(anjuTotal);
  document.getElementById("ledgerDrink").textContent = fmtWon(drinkTotal);

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

async function toggleConfirmed(orderId, checked) {
  const confirmedAt = checked ? new Date().toISOString() : null;
  try {
    if (appDb) {
      await appDb.collection("orders").doc(orderId).update({ confirmedAt });
    } else {
      const o = ordersCache.find((x) => x.id === orderId);
      if (o) o.confirmedAt = confirmedAt;
      saveLocalData();
      refreshDataScreens();
    }
  } catch (e) {
    console.error("주문 확인 처리 실패", e);
    showToast("처리에 실패했어요. 다시 시도해주세요.");
    renderLedger();
  }
}

async function toggleServed(orderId, checked) {
  const servedAt = checked ? new Date().toISOString() : null;
  try {
    if (appDb) {
      await appDb.collection("orders").doc(orderId).update({ servedAt });
    } else {
      const o = ordersCache.find((x) => x.id === orderId);
      if (o) o.servedAt = servedAt;
      saveLocalData();
      refreshDataScreens();
    }
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

  if (inClaudeViewer) {
    if (!downloadsApi) { showToast("이 화면에서는 엑셀 다운로드가 지원되지 않아요."); return; }
    try {
      await downloadsApi.save({ filename, data: blob });
      showToast("엑셀 파일을 저장했어요!");
    } catch (e) {
      if (e && e.code === "declined") return;
      console.error("엑셀 다운로드 실패", e);
      showToast("다운로드에 실패했어요. 다시 시도해주세요.");
    }
  } else {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
}

async function resetAll() {
  if (!confirm("정말 모든 주문 기록을 초기화할까요? 되돌릴 수 없어요.")) return;
  if (!confirm("한 번 더 확인할게요. 전체 주문 데이터를 삭제합니다. 진행할까요?")) return;
  try {
    if (appDb) {
      const osnap = await appDb.collection("orders").limit(1000).get();
      await Promise.all(osnap.docs.map((d) => appDb.collection("orders").doc(d.id).delete()));
      const tsnap = await appDb.collection("tables").limit(1000).get();
      await Promise.all(tsnap.docs.map((d) => appDb.collection("tables").doc(d.id).delete()));
      const wsnap = await appDb.collection("waiting").limit(1000).get();
      await Promise.all(wsnap.docs.map((d) => appDb.collection("waiting").doc(d.id).delete()));
    } else {
      ordersCache = [];
      tablesCache = {};
      waitingCache = [];
      saveLocalData();
      refreshDataScreens();
    }
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
  try {
    if (appDb) {
      await appDb.collection("waiting").add(entry);
    } else {
      entry.id = "local-wait-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7);
      waitingCache.push(entry);
      saveLocalData();
      refreshDataScreens();
    }
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
    if (appDb) {
      await appDb.collection("waiting").doc(id).delete();
    } else {
      waitingCache = waitingCache.filter((w) => w.id !== id);
      saveLocalData();
      refreshDataScreens();
    }
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

async function boot() {
  setSyncDot("connecting");
  try {
    if (window.claude && typeof window.claude.use === "function") {
      const db = await window.claude.use("db");
      if (db) {
        appDb = db;
        setSyncDot("live");
        appDb.collection("orders").orderBy("createdAt", "asc").limit(1000).onSnapshot(
          (snap) => {
            ordersCache = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
            refreshDataScreens();
          },
          (err) => console.error("orders 구독 오류", err)
        );
        appDb.collection("tables").onSnapshot(
          (snap) => {
            const map = {};
            snap.docs.forEach((d) => { map[d.id] = d.data() || {}; });
            tablesCache = map;
            refreshDataScreens();
          },
          (err) => console.error("tables 구독 오류", err)
        );
        appDb.collection("waiting").orderBy("createdAt", "asc").limit(200).onSnapshot(
          (snap) => {
            waitingCache = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
            refreshDataScreens();
          },
          (err) => console.error("waiting 구독 오류", err)
        );
      }
    }
  } catch (e) {
    console.error("db 초기화 실패", e);
  }
  if (!appDb) {
    setSyncDot("local");
    loadLocalData();
  }
  if (inClaudeViewer) {
    try { downloadsApi = await window.claude.use("downloads"); }
    catch (e) { downloadsApi = null; }
  }
}

wireStaticUI();
setScreen("home");
renderHomeTables();
boot();
