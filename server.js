// เซิร์ฟเวอร์ Express ของระบบสั่งอาหารออนไลน์ (npm start แล้วเปิด http://localhost:3000)
const path = require("path");
const express = require("express");
const { pool } = require("./db");
const { port } = require("./config");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const ORDER_STATUSES = ["pending", "preparing", "delivered", "cancelled"];

// ===================== เมนู (menu_items) =====================

// GET /api/menu ดูเมนูทั้งหมด (กรองเฉพาะที่มีขายได้ด้วย ?available=true)
app.get("/api/menu", async (req, res) => {
  try {
    let sql = "SELECT * FROM menu_items";
    if (req.query.available === "true") sql += " WHERE available = TRUE";
    const [rows] = await pool.query(sql + " ORDER BY id");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/menu/:id ดูเมนูตาม id
app.get("/api/menu/:id", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM menu_items WHERE id = ?", [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: "ไม่พบเมนู" });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/menu เพิ่มเมนู body: { name, price, available? }
app.post("/api/menu", async (req, res) => {
  const { name, price, available = true } = req.body;
  if (!name || price === undefined || Number(price) < 0) {
    return res.status(400).json({ error: "กรุณาระบุชื่อและราคาให้ถูกต้อง" });
  }
  try {
    const [result] = await pool.query("INSERT INTO menu_items (name, price, available) VALUES (?, ?, ?)", [name, price, available]);
    const [rows] = await pool.query("SELECT * FROM menu_items WHERE id = ?", [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/menu/:id แก้ไขเมนู body: { name, price, available }
app.put("/api/menu/:id", async (req, res) => {
  const { name, price, available } = req.body;
  if (!name || price === undefined || Number(price) < 0 || available === undefined) {
    return res.status(400).json({ error: "กรุณาระบุ name, price และ available ให้ครบ" });
  }
  try {
    const [result] = await pool.query("UPDATE menu_items SET name = ?, price = ?, available = ? WHERE id = ?", [
      name,
      price,
      available,
      req.params.id,
    ]);
    if (result.affectedRows === 0) return res.status(404).json({ error: "ไม่พบเมนู" });
    const [rows] = await pool.query("SELECT * FROM menu_items WHERE id = ?", [req.params.id]);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/menu/:id ลบเมนู (ลบไม่ได้ถ้าเคยถูกสั่งไปแล้ว)
app.delete("/api/menu/:id", async (req, res) => {
  try {
    const [result] = await pool.query("DELETE FROM menu_items WHERE id = ?", [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: "ไม่พบเมนู" });
    res.status(204).end();
  } catch (err) {
    if (err.code === "ER_ROW_IS_REFERENCED_2") {
      return res.status(409).json({ error: "ลบไม่ได้ เพราะเมนูนี้มีอยู่ในคำสั่งซื้อแล้ว" });
    }
    res.status(500).json({ error: err.message });
  }
});

// ===================== คำสั่งซื้อ (orders) =====================

// ดึงคำสั่งซื้อ 1 รายการพร้อมรายการอาหารและยอดรวม
async function findOrder(id) {
  const [orders] = await pool.query("SELECT * FROM orders WHERE id = ?", [id]);
  if (orders.length === 0) return null;
  const [items] = await pool.query(
    `SELECT oi.id, oi.menu_item_id, m.name, m.price, oi.quantity
     FROM order_items oi JOIN menu_items m ON m.id = oi.menu_item_id
     WHERE oi.order_id = ?`,
    [id],
  );
  const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  return { ...orders[0], items, total };
}

// ตรวจ items ว่าถูกต้องและเมนูยังมีขายอยู่ คืนข้อความ error หรือ null
async function validateItems(items) {
  if (!Array.isArray(items) || items.length === 0) return "กรุณาเลือกเมนูอย่างน้อย 1 รายการ";
  for (const item of items) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) return "จำนวนต้องเป็นจำนวนเต็มมากกว่า 0";
    const [rows] = await pool.query("SELECT available FROM menu_items WHERE id = ?", [item.menu_item_id]);
    if (rows.length === 0) return `ไม่พบเมนู id ${item.menu_item_id}`;
    if (!rows[0].available) return `เมนู id ${item.menu_item_id} หมดแล้ว`;
  }
  return null;
}

// GET /api/orders ดูคำสั่งซื้อทั้งหมด พร้อมยอดรวม (กรองสถานะด้วย ?status=pending)
app.get("/api/orders", async (req, res) => {
  try {
    const params = [];
    let where = "";
    if (req.query.status) {
      where = "WHERE o.status = ?";
      params.push(req.query.status);
    }
    const [rows] = await pool.query(
      `SELECT o.id, o.customer_name, o.status, o.created_at,
              COALESCE(SUM(oi.quantity * m.price), 0) AS total
       FROM orders o
       LEFT JOIN order_items oi ON oi.order_id = o.id
       LEFT JOIN menu_items m ON m.id = oi.menu_item_id
       ${where}
       GROUP BY o.id
       ORDER BY o.id DESC`,
      params,
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/orders/:id ดูคำสั่งซื้อพร้อมรายการอาหาร
app.get("/api/orders/:id", async (req, res) => {
  try {
    const order = await findOrder(req.params.id);
    if (!order) return res.status(404).json({ error: "ไม่พบคำสั่งซื้อ" });
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/orders สร้างคำสั่งซื้อ body: { customer_name, items: [{ menu_item_id, quantity }] }
app.post("/api/orders", async (req, res) => {
  const { customer_name, items } = req.body;
  if (!customer_name) return res.status(400).json({ error: "กรุณาระบุชื่อผู้สั่ง" });

  const conn = await pool.getConnection();
  try {
    const itemError = await validateItems(items);
    if (itemError) return res.status(400).json({ error: itemError });

    await conn.beginTransaction();
    const [result] = await conn.query("INSERT INTO orders (customer_name) VALUES (?)", [customer_name]);
    for (const item of items) {
      await conn.query("INSERT INTO order_items (order_id, menu_item_id, quantity) VALUES (?, ?, ?)", [
        result.insertId,
        item.menu_item_id,
        item.quantity,
      ]);
    }
    await conn.commit();
    res.status(201).json(await findOrder(result.insertId));
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// PUT /api/orders/:id แก้ไขคำสั่งซื้อ (เฉพาะสถานะ pending) body: { customer_name, items }
app.put("/api/orders/:id", async (req, res) => {
  const { customer_name, items } = req.body;
  if (!customer_name) return res.status(400).json({ error: "กรุณาระบุชื่อผู้สั่ง" });

  const conn = await pool.getConnection();
  try {
    const order = await findOrder(req.params.id);
    if (!order) return res.status(404).json({ error: "ไม่พบคำสั่งซื้อ" });
    if (order.status !== "pending") {
      return res.status(409).json({ error: "แก้ไขได้เฉพาะคำสั่งซื้อที่ยังรอดำเนินการ" });
    }
    const itemError = await validateItems(items);
    if (itemError) return res.status(400).json({ error: itemError });

    await conn.beginTransaction();
    await conn.query("UPDATE orders SET customer_name = ? WHERE id = ?", [customer_name, req.params.id]);
    await conn.query("DELETE FROM order_items WHERE order_id = ?", [req.params.id]);
    for (const item of items) {
      await conn.query("INSERT INTO order_items (order_id, menu_item_id, quantity) VALUES (?, ?, ?)", [
        req.params.id,
        item.menu_item_id,
        item.quantity,
      ]);
    }
    await conn.commit();
    res.json(await findOrder(req.params.id));
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// PATCH /api/orders/:id/status เปลี่ยนสถานะ body: { status }
app.patch("/api/orders/:id/status", async (req, res) => {
  if (!ORDER_STATUSES.includes(req.body.status)) {
    return res.status(400).json({ error: `สถานะต้องเป็น ${ORDER_STATUSES.join(", ")}` });
  }
  try {
    const [result] = await pool.query("UPDATE orders SET status = ? WHERE id = ?", [req.body.status, req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: "ไม่พบคำสั่งซื้อ" });
    res.json(await findOrder(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/orders/:id ลบคำสั่งซื้อ (order_items ถูกลบตามด้วย ON DELETE CASCADE)
app.delete("/api/orders/:id", async (req, res) => {
  try {
    const [result] = await pool.query("DELETE FROM orders WHERE id = ?", [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: "ไม่พบคำสั่งซื้อ" });
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// เส้นทาง /api ที่ไม่มีอยู่
app.use("/api", (req, res) => res.status(404).json({ error: "ไม่พบ endpoint" }));

if (require.main === module) {
  app.listen(port, () => console.log(`เปิดเว็บได้ที่ http://localhost:${port}`));
}

module.exports = app;
