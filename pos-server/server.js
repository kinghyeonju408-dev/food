// ================= 일일호프 POS 서버 =================
// Express 정적 파일 서빙 + REST API + 파일 기반(JSON) 저장소
// 모든 기기가 이 서버 하나를 바라보게 되어, Claude 계정/조직과 무관하게 실시간 공유가 됩니다.

const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8080;
const DATA_FILE = path.join(__dirname, "data.json");

function emptyData() {
  return { orders: [], tables: {}, waiting: [], soldout: { items: {} } };
}

function loadData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Object.assign(emptyData(), parsed);
  } catch (e) {
    return emptyData();
  }
}

let db = loadData();

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/state", (req, res) => {
  res.json(db);
});

app.post("/api/orders", (req, res) => {
  const order = req.body;
  if (!order || !order.id) return res.status(400).json({ error: "id required" });
  db.orders.push(order);
  saveData();
  res.status(201).json(order);
});

app.patch("/api/orders/:id", (req, res) => {
  const order = db.orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: "not found" });
  Object.assign(order, req.body || {});
  saveData();
  res.json(order);
});

app.patch("/api/tables/:n", (req, res) => {
  db.tables[req.params.n] = req.body || {};
  saveData();
  res.json(db.tables[req.params.n]);
});

app.post("/api/waiting", (req, res) => {
  const entry = req.body;
  if (!entry || !entry.id) return res.status(400).json({ error: "id required" });
  db.waiting.push(entry);
  saveData();
  res.status(201).json(entry);
});

app.delete("/api/waiting/:id", (req, res) => {
  db.waiting = db.waiting.filter((w) => w.id !== req.params.id);
  saveData();
  res.json({ ok: true });
});

app.patch("/api/soldout", (req, res) => {
  const { name, value } = req.body || {};
  if (!name) return res.status(400).json({ error: "name required" });
  if (!db.soldout) db.soldout = { items: {} };
  db.soldout.items[name] = value;
  saveData();
  res.json(db.soldout);
});

app.post("/api/reset", (req, res) => {
  db = emptyData();
  saveData();
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`일일호프 POS 서버가 ${PORT} 포트에서 실행 중입니다.`);
});
