// ================= 일일호프 POS =================
// 안주 / 주류-음료 메뉴, 테이블 1~22 (1층 1~10, 지하1층 11~22)

const MENU = {
  anju:  { label: "안주",        emoji: "🍢",
    items: ["짜파게티 감바스","신라면 볶음밥","김치 어묵탕","불닭냉면","마른안주 플레터","프렌치 토스트","옥수수전","쏘야"] },
  drink: { label: "주류 및 음료", emoji: "🍻",
    items: ["소주","맥주","메롱주","봉알주","요쏘","황도소다 하이볼","콜라","제로콜라","사이다"] },
};

const TABLE_COUNT = 22;
const FIRST_FLOOR_MAX = 10; // 1~10: 1층, 11~22: 지하1층

// ---------------- 상태 ----------------
let screen = "home";
let currentCat = null;
let currentTable = null;
let cart = {};              // { 메뉴명: 수량 }
let modalItem = null;
let modalQty = 1;

let appDb = null;           // claude db 네임스페이스 (없으면 로컬 모드)
let ordersCache = [];       // [{id, tableNum, category, items:[{name,qty}], createdAt, batch}]
let tablesCache = {};       // { "5": {currentBatch, settlements:[{batch, settledAt}]} }

const LS_ORDERS = "ilhof_pos_orders";
const LS_TABLES = "ilhof_pos_tables";

// ---------------- 유틸 ----------------
function fmtTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "--:--";
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
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
  renderRecords();
}
function saveLocalData() {
  localStorage.setItem(LS_ORDERS, JSON.stringify(ordersCache));
  localStorage.setItem(LS_TABLES, JSON.stringify(tablesCache));
}
window.addEventListener("storage", (e) => {
  if (!appDb && (e.key === LS_ORDERS || e.key === LS_TABLES)) loadLocalData();
});

// ---------------- 화면 전환 ----------------
function setScreen(name) {
  screen = name;
  document.querySelectorAll(".screen").forEach((el) => { el.hidden = el.id !== "screen-" + name; });
  document.getElementById("backBtn").hidden = name === "home";
  document.getElementById("navBtn").textContent = name === "records" ? "🏠 홈으로" : "📋 테이블별 주문";
  document.getElementById("cartBar").hidden = !(name === "menu" && Object.keys(cart).length > 0);
}

function showHome() { currentCat = null; currentTable = null; cart = {}; setScreen("home"); }
function showTableSelect(cat) { currentCat = cat; setScreen("tables"); renderTableSelect(); }
function showMenu(table) { currentTable = table; cart = {}; setScreen("menu"); renderMenu(); }
function showRecords() { setScreen("records"); renderRecords(); }

function onBack() {
  if (screen === "tables") showHome();
  else if (screen === "menu") { cart = {}; setScreen("tables"); renderTableSelect(); }
  else if (screen === "records") showHome();
}

// ---------------- 테이블 선택 화면 ----------------
function renderTableSelect() {
  const cat = MENU[currentCat];
  document.getElementById("tablesContext").innerHTML =
    `<span class="context-pill on">${cat.emoji} ${cat.label} 주문</span><span class="context-pill">테이블을 선택하세요</span>`;

  const g1 = document.getElementById("tableGrid1F"); g1.innerHTML = "";
  const g2 = document.getElementById("tableGridB1"); g2.innerHTML = "";
  for (let n = 1; n <= TABLE_COUNT; n++) {
    const btn = document.createElement("button");
    btn.className = "table-btn";
    btn.innerHTML = `${n}<span class="lab">테이블</span>`;
    btn.addEventListener("click", () => showMenu(n));
    (n <= FIRST_FLOOR_MAX ? g1 : g2).appendChild(btn);
  }
}

// ---------------- 메뉴 & 장바구니 화면 ----------------
function renderMenu() {
  const cat = MENU[currentCat];
  document.getElementById("menuContext").innerHTML =
    `<span class="context-pill on">${cat.emoji} ${cat.label}</span><span class="context-pill on">🍽 테이블 ${currentTable}</span>`;

  const grid = document.getElementById("menuGrid");
  grid.innerHTML = "";
  cat.items.forEach((name) => {
    const btn = document.createElement("button");
    btn.className = "menu-item";
    btn.textContent = name;
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

function openQtyModal(name) {
  modalItem = name;
  modalQty = 1;
  document.getElementById("qtyName").textContent = name;
  document.getElementById("qtyNum").textContent = modalQty;
  document.getElementById("qtyModal").hidden = false;
}
function closeQtyModal() { document.getElementById("qtyModal").hidden = true; modalItem = null; }
function stepQty(delta) {
  modalQty = Math.max(1, Math.min(99, modalQty + delta));
  document.getElementById("qtyNum").textContent = modalQty;
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
  if (screen !== "menu" || entries.length === 0) { bar.hidden = true; return; }
  bar.hidden = false;

  const chips = document.getElementById("cartChips");
  chips.innerHTML = "";
  let total = 0;
  entries.forEach(([name, qty]) => {
    total += qty;
    const chip = document.createElement("div");
    chip.className = "cart-chip";
    chip.innerHTML = `<span>${name} <span class="n">×${qty}</span></span>`;
    const rm = document.createElement("button");
    rm.textContent = "✕";
    rm.addEventListener("click", () => { delete cart[name]; renderMenu(); });
    chip.appendChild(rm);
    chips.appendChild(chip);
  });
  document.getElementById("cartConfirmBtn").textContent = `주문 확정하기 (총 ${total}개)`;
}
function clearCart() { cart = {}; renderMenu(); }

async function submitOrder() {
  const items = Object.entries(cart).map(([name, qty]) => ({ name, qty }));
  if (items.length === 0 || !currentTable || !currentCat) return;

  const confirmBtn = document.getElementById("cartConfirmBtn");
  confirmBtn.disabled = true;

  const batch = (tablesCache[String(currentTable)] && tablesCache[String(currentTable)].currentBatch) || 1;
  const order = {
    tableNum: currentTable,
    category: MENU[currentCat].label,
    items,
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
      renderRecords();
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

// ---------------- 테이블별 주문 기록 화면 ----------------
function renderRecords() {
  if (screen !== "records") return;
  const grid = document.getElementById("recordsGrid");
  grid.innerHTML = "";

  for (let n = 1; n <= TABLE_COUNT; n++) {
    const floor = n <= FIRST_FLOOR_MAX ? "1층" : "지하 1층";
    const tstate = tablesCache[String(n)] || { currentBatch: 1, settlements: [] };
    const myOrders = ordersCache
      .filter((o) => Number(o.tableNum) === n)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));

    const card = document.createElement("div");
    card.className = "table-card";

    const head = document.createElement("div");
    head.className = "table-card-head";
    head.innerHTML = `<span class="tno">테이블 ${n}</span><span class="floor">${floor}</span>`;
    card.appendChild(head);

    const log = document.createElement("div");
    log.className = "order-log";
    if (myOrders.length === 0) {
      log.innerHTML = `<div class="order-empty">아직 주문이 없어요</div>`;
    } else {
      let lastBatch = null;
      myOrders.forEach((o) => {
        if (lastBatch !== null && o.batch !== lastBatch) {
          const settleInfo = (tstate.settlements || []).find((s) => s.batch === lastBatch);
          const div = document.createElement("div");
          div.className = "settle-divider";
          div.innerHTML = `<span class="line"></span><span class="tag">💳 계산 완료${settleInfo ? " · " + fmtTime(settleInfo.settledAt) : ""}</span><span class="line"></span>`;
          log.appendChild(div);
        }
        const entry = document.createElement("div");
        entry.className = "order-entry";
        const itemsStr = (o.items || []).map((it) => `${it.name} ×${it.qty}`).join(", ");
        entry.innerHTML = `<span class="t">${fmtTime(o.createdAt)}</span>${itemsStr} <span class="cat-tag">(${o.category || ""})</span>`;
        log.appendChild(entry);
        lastBatch = o.batch;
      });
    }
    card.appendChild(log);

    const openBatch = tstate.currentBatch || 1;
    const hasOpen = myOrders.some((o) => o.batch === openBatch);
    const settleBtn = document.createElement("button");
    settleBtn.className = "settle-btn";
    settleBtn.textContent = hasOpen ? "💳 계산 완료 처리" : "정산할 주문 없음";
    settleBtn.disabled = !hasOpen;
    settleBtn.addEventListener("click", () => settleTable(n));
    card.appendChild(settleBtn);

    grid.appendChild(card);
  }
}

async function settleTable(n) {
  const cur = tablesCache[String(n)] || { currentBatch: 1, settlements: [] };
  const openBatch = cur.currentBatch || 1;
  const hasOpenOrders = ordersCache.some((o) => Number(o.tableNum) === n && o.batch === openBatch);
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
      renderRecords();
    }
    showToast(`테이블 ${n}번 계산 완료 처리했어요.`);
  } catch (e) {
    console.error("계산 완료 처리 실패", e);
    showToast("처리에 실패했어요. 다시 시도해주세요.");
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
    } else {
      ordersCache = [];
      tablesCache = {};
      saveLocalData();
      renderRecords();
    }
    showToast("초기화 완료");
  } catch (e) {
    console.error("초기화 실패", e);
    showToast("초기화에 실패했어요.");
  }
}

// ---------------- 초기 바인딩 & 부팅 ----------------
function wireStaticUI() {
  document.querySelectorAll(".category-card").forEach((el) => {
    el.addEventListener("click", () => showTableSelect(el.dataset.cat));
  });
  document.getElementById("backBtn").addEventListener("click", onBack);
  document.getElementById("navBtn").addEventListener("click", () => {
    screen === "records" ? showHome() : showRecords();
  });
  document.getElementById("qtyMinus").addEventListener("click", () => stepQty(-1));
  document.getElementById("qtyPlus").addEventListener("click", () => stepQty(1));
  document.getElementById("qtyAddBtn").addEventListener("click", addModalToCart);
  document.getElementById("qtyCancelBtn").addEventListener("click", closeQtyModal);
  document.getElementById("qtyModal").addEventListener("click", (e) => {
    if (e.target.id === "qtyModal") closeQtyModal();
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
            renderRecords();
          },
          (err) => console.error("orders 구독 오류", err)
        );
        appDb.collection("tables").onSnapshot(
          (snap) => {
            const map = {};
            snap.docs.forEach((d) => { map[d.id] = d.data() || {}; });
            tablesCache = map;
            renderRecords();
          },
          (err) => console.error("tables 구독 오류", err)
        );
        return;
      }
    }
  } catch (e) {
    console.error("db 초기화 실패", e);
  }
  setSyncDot("local");
  loadLocalData();
}

wireStaticUI();
setScreen("home");
boot();
