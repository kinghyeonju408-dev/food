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

// 메뉴명 -> 가격 조회용
const PRICE = {};
Object.values(MENU).forEach((cat) => cat.items.forEach((it) => { PRICE[it.name] = it.price; }));

const TABLE_COUNT = 22;
const FIRST_FLOOR_MAX = 10; // 1~10: 1층, 11~22: 지하1층
const inClaudeViewer = !!(window.claude && typeof window.claude.use === "function");
let downloadsApi = null;

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
function fmtDateTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "-";
  return d.toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}
function fmtWon(n) { return "₩" + Math.round(n || 0).toLocaleString("ko-KR"); }
function orderAmount(order) {
  return (order.items || []).reduce((s, it) => s + (Number(it.price || 0) * Number(it.qty || 0)), 0);
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
  refreshDataScreens();
}
function refreshDataScreens() { renderRecords(); renderLedger(); }
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
  document.getElementById("navRecordsBtn").hidden = name === "records" || name === "tables" || name === "menu";
  document.getElementById("navLedgerBtn").hidden = name === "ledger" || name === "tables" || name === "menu";
  document.getElementById("cartBar").hidden = !(name === "menu" && Object.keys(cart).length > 0);
}

function showHome() { currentCat = null; currentTable = null; cart = {}; setScreen("home"); }
function showTableSelect(cat) { currentCat = cat; setScreen("tables"); renderTableSelect(); }
function showMenu(table) { currentTable = table; cart = {}; setScreen("menu"); renderMenu(); }
function showRecords() { setScreen("records"); renderRecords(); }
function showLedger() { setScreen("ledger"); renderLedger(); }

function onBack() {
  if (screen === "tables") showHome();
  else if (screen === "menu") { cart = {}; setScreen("tables"); renderTableSelect(); }
  else if (screen === "records") showHome();
  else if (screen === "ledger") showHome();
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

function openQtyModal(name) {
  modalItem = name;
  modalQty = 1;
  document.getElementById("qtyName").textContent = name;
  document.getElementById("qtyNum").textContent = modalQty;
  updateQtySubtotal();
  document.getElementById("qtyModal").hidden = false;
}
function closeQtyModal() { document.getElementById("qtyModal").hidden = true; modalItem = null; }
function updateQtySubtotal() {
  const price = PRICE[modalItem] || 0;
  document.getElementById("qtySubtotal").textContent = `${fmtWon(price)} × ${modalQty} = ${fmtWon(price * modalQty)}`;
}
function stepQty(delta) {
  modalQty = Math.max(1, Math.min(99, modalQty + delta));
  document.getElementById("qtyNum").textContent = modalQty;
  updateQtySubtotal();
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
  let totalQty = 0, totalAmount = 0;
  entries.forEach(([name, qty]) => {
    totalQty += qty;
    totalAmount += (PRICE[name] || 0) * qty;
    const chip = document.createElement("div");
    chip.className = "cart-chip";
    chip.innerHTML = `<span>${name} <span class="n">×${qty}</span></span>`;
    const rm = document.createElement("button");
    rm.textContent = "✕";
    rm.addEventListener("click", () => { delete cart[name]; renderMenu(); });
    chip.appendChild(rm);
    chips.appendChild(chip);
  });
  document.getElementById("cartConfirmBtn").textContent = `주문 확정하기 (${totalQty}개 · ${fmtWon(totalAmount)})`;
}
function clearCart() { cart = {}; renderMenu(); }

async function submitOrder() {
  const items = Object.entries(cart).map(([name, qty]) => ({ name, qty, price: PRICE[name] || 0 }));
  if (items.length === 0 || !currentTable || !currentCat) return;

  const confirmBtn = document.getElementById("cartConfirmBtn");
  confirmBtn.disabled = true;

  const batch = (tablesCache[String(currentTable)] && tablesCache[String(currentTable)].currentBatch) || 1;
  const order = {
    tableNum: currentTable,
    category: MENU[currentCat].label,
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

    const tableTotal = myOrders.reduce((s, o) => s + orderAmount(o), 0);
    const head = document.createElement("div");
    head.className = "table-card-head";
    head.innerHTML = `<span class="tno">테이블 ${n}</span><span class="floor">${floor} · ${fmtWon(tableTotal)}</span>`;
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
        entry.innerHTML = `<span class="t">${fmtTime(o.createdAt)}</span>${itemsStr}
          <span class="cat-tag">(${o.category || ""})</span>
          <span class="entry-amt mono">${fmtWon(orderAmount(o))}</span>`;
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

function renderLedger() {
  if (screen !== "ledger") return;
  const rows = allOrdersSorted();
  const totalAmount = rows.reduce((s, o) => s + orderAmount(o), 0);
  const anjuTotal = rows.filter((o) => o.category === MENU.anju.label).reduce((s, o) => s + orderAmount(o), 0);
  const drinkTotal = rows.filter((o) => o.category === MENU.drink.label).reduce((s, o) => s + orderAmount(o), 0);

  document.getElementById("ledgerCount").textContent = rows.length + "건";
  document.getElementById("ledgerTotal").textContent = fmtWon(totalAmount);
  document.getElementById("ledgerAnju").textContent = fmtWon(anjuTotal);
  document.getElementById("ledgerDrink").textContent = fmtWon(drinkTotal);

  const body = document.getElementById("ledgerBody");
  body.innerHTML = "";
  if (rows.length === 0) {
    body.innerHTML = `<tr><td colspan="5" class="ledger-empty">아직 주문 내역이 없어요</td></tr>`;
    return;
  }
  rows.forEach((o) => {
    const tr = document.createElement("tr");
    const itemsStr = (o.items || []).map((it) => `${it.name} ×${it.qty}`).join(", ");
    tr.innerHTML = `
      <td class="mono">${fmtDateTime(o.createdAt)}</td>
      <td>테이블 ${o.tableNum}</td>
      <td>${o.category || ""}</td>
      <td>${itemsStr}</td>
      <td class="mono amt">${fmtWon(orderAmount(o))}</td>`;
    body.appendChild(tr);
  });
}

async function exportExcel() {
  if (typeof XLSX === "undefined") { showToast("엑셀 기능을 불러오지 못했어요. 새로고침 후 다시 시도해주세요."); return; }
  const rows = allOrdersSorted();
  const totalAmount = rows.reduce((s, o) => s + orderAmount(o), 0);

  const aoa = [["시간", "테이블", "구분", "주문 내역", "금액"]];
  rows.forEach((o) => {
    aoa.push([
      fmtDateTime(o.createdAt),
      `테이블 ${o.tableNum}`,
      o.category || "",
      (o.items || []).map((it) => `${it.name} x${it.qty}`).join(", "),
      orderAmount(o),
    ]);
  });
  aoa.push([]);
  aoa.push(["", "", "", "총 매출", totalAmount]);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 14 }, { wch: 10 }, { wch: 12 }, { wch: 42 }, { wch: 12 }];
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
    } else {
      ordersCache = [];
      tablesCache = {};
      saveLocalData();
      refreshDataScreens();
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
  document.getElementById("navRecordsBtn").addEventListener("click", showRecords);
  document.getElementById("navLedgerBtn").addEventListener("click", showLedger);
  document.getElementById("exportExcelBtn").addEventListener("click", exportExcel);
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
boot();
