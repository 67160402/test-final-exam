// โค้ดฝั่งหน้าเว็บ: ดึงเมนู จัดการตะกร้า และสั่งอาหารผ่าน API
let menu = [];
let cart = {}; // { menu_item_id: quantity }

const statusText = {
  pending: "รอดำเนินการ",
  preparing: "กำลังทำ",
  delivered: "ส่งแล้ว",
  cancelled: "ยกเลิก",
};

async function loadMenu() {
  const res = await fetch("/api/menu");
  menu = await res.json();
  const list = document.getElementById("menu-list");
  list.innerHTML = "";
  for (const item of menu) {
    const card = document.createElement("div");
    card.className = "card" + (item.available ? "" : " sold-out");
    card.innerHTML = `
      <div class="name">${item.name}</div>
      <div class="price">${Number(item.price)} บาท</div>
      <button ${item.available ? "" : "disabled"}>${item.available ? "เพิ่มลงตะกร้า" : "หมด"}</button>
    `;
    card.querySelector("button").onclick = () => changeQty(item.id, 1);
    list.appendChild(card);
  }
}

function changeQty(id, diff) {
  cart[id] = (cart[id] || 0) + diff;
  if (cart[id] <= 0) delete cart[id];
  renderCart();
}

function renderCart() {
  const list = document.getElementById("cart-list");
  list.innerHTML = "";
  let total = 0;
  for (const id in cart) {
    const item = menu.find((m) => m.id == id);
    total += item.price * cart[id];
    const li = document.createElement("li");
    li.innerHTML = `
      <span>${item.name} x ${cart[id]}</span>
      <span><button class="minus">-</button><button class="plus">+</button></span>
    `;
    li.querySelector(".minus").onclick = () => changeQty(id, -1);
    li.querySelector(".plus").onclick = () => changeQty(id, 1);
    list.appendChild(li);
  }
  if (list.children.length === 0) list.innerHTML = "<li>ยังไม่มีสินค้า</li>";
  document.getElementById("cart-total").textContent = total;
}

async function placeOrder() {
  const message = document.getElementById("message");
  const name = document.getElementById("customer-name").value.trim();
  const items = Object.keys(cart).map((id) => ({ menu_item_id: Number(id), quantity: cart[id] }));

  if (!name || items.length === 0) {
    message.textContent = "กรุณากรอกชื่อและเลือกเมนูก่อน";
    return;
  }

  const res = await fetch("/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ customer_name: name, items }),
  });
  const data = await res.json();

  if (res.ok) {
    message.textContent = `สั่งอาหารสำเร็จ! เลขที่ออเดอร์ #${data.id}`;
    cart = {};
    document.getElementById("customer-name").value = "";
    renderCart();
    loadOrders();
  } else {
    message.textContent = data.error;
  }
}

async function loadOrders() {
  const res = await fetch("/api/orders");
  const orders = await res.json();
  const tbody = document.getElementById("order-list");
  tbody.innerHTML = "";
  for (const o of orders) {
    const tr = document.createElement("tr");
    const options = Object.keys(statusText)
      .map((s) => `<option value="${s}" ${s === o.status ? "selected" : ""}>${statusText[s]}</option>`)
      .join("");
    tr.innerHTML = `
      <td>${o.id}</td>
      <td>${o.customer_name}</td>
      <td>${Number(o.total)} บาท</td>
      <td>${new Date(o.created_at).toLocaleString("th-TH")}</td>
      <td><select>${options}</select></td>
    `;
    tr.querySelector("select").onchange = (e) => updateStatus(o.id, e.target.value);
    tbody.appendChild(tr);
  }
}

async function updateStatus(id, status) {
  await fetch(`/api/orders/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
}

document.getElementById("order-btn").onclick = placeOrder;
loadMenu().then(renderCart);
loadOrders();
