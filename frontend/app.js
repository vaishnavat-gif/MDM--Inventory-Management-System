"use strict";

const $ = (sel) => document.querySelector(sel);
const money = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/* ---------- API helper (Fetch + JSON) ---------- */
// Backend address. Change this if your Flask server runs elsewhere.
const API_BASE = window.API_BASE || "http://127.0.0.1:5000/api";

async function api(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    headers: { "Content-Type": "application/json" },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

let toastTimer;
function toast(msg, isError = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast show" + (isError ? " error" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = "toast"), 2800);
}

/* ---------- rendering ---------- */
let products = [];

function renderRows() {
  const body = $("#rows");
  body.innerHTML = products
    .map((p) => {
      const cls = (p.low_stock ? "low " : "") + (p.quantity === 0 ? "out" : "");
      return `<tr class="${cls}" data-id="${p.id}">
        <td class="sku">${esc(p.sku)}</td>
        <td>${esc(p.name)}${p.low_stock ? `<span class="badge">${p.quantity === 0 ? "out" : "low"}</span>` : ""}</td>
        <td>${esc(p.category)}</td>
        <td class="num">₹${money.format(p.price)}</td>
        <td class="num qty">${p.quantity}</td>
        <td><div class="adjust">
          <button data-act="remove" aria-label="Remove stock">−</button>
          <input type="number" min="1" step="1" value="1" aria-label="Units" />
          <button data-act="add" aria-label="Add stock">+</button>
        </div></td>
        <td><button data-act="edit">Edit</button> <button class="danger" data-act="delete">Delete</button></td>
      </tr>`;
    })
    .join("");

  const empty = $("#empty");
  const filtering = $("#search").value || $("#cat-filter").value || $("#low-only").checked;
  empty.hidden = products.length > 0;
  empty.textContent = filtering
    ? "No products match your search. Try a different ID, name or category."
    : "No products yet. Add your first one using the form.";
}

async function loadProducts() {
  const params = new URLSearchParams();
  if ($("#search").value.trim()) params.set("q", $("#search").value.trim());
  if ($("#cat-filter").value) params.set("category", $("#cat-filter").value);
  if ($("#low-only").checked) params.set("low", "1");
  try {
    products = (await api("/products?" + params)).products;
    renderRows();
  } catch (e) {
    toast(e.message, true);
  }
}

async function loadSideData() {
  const [s, cats, moves] = await Promise.all([api("/stats"), api("/categories"), api("/movements")]);
  $("#s-products").textContent = s.products;
  $("#s-units").textContent = s.units;
  $("#s-value").textContent = money.format(s.value);
  $("#s-low").textContent = s.low;

  const alertBox = $("#alert");
  alertBox.hidden = s.low === 0;
  alertBox.textContent = `⚠ ${s.low} product${s.low === 1 ? " is" : "s are"} at or below reorder level.`;

  $("#cats").innerHTML = cats.map((c) => `<option value="${esc(c)}">`).join("");
  const sel = $("#cat-filter");
  const keep = sel.value;
  sel.innerHTML = '<option value="">All categories</option>' + cats.map((c) => `<option>${esc(c)}</option>`).join("");
  sel.value = cats.includes(keep) ? keep : "";

  $("#log").innerHTML = moves.length
    ? moves
        .map(
          (m) => `<li><span>${esc(m.product_name)}<small>${esc(m.reason)}</small></span>
          <span class="${m.change > 0 ? "in" : "out"}">${m.change > 0 ? "+" : ""}${m.change}</span></li>`
        )
        .join("")
    : "<li><span>Nothing yet - changes to stock appear here.</span></li>";
}

const refresh = () => Promise.all([loadProducts(), loadSideData()]);

/* ---------- add product ---------- */
$("#add-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const form = ev.target;
  const body = Object.fromEntries(new FormData(form));
  try {
    const p = await api("/products", { method: "POST", body });
    toast(`Added ${p.name}`);
    form.reset();
    await refresh();
  } catch (e) {
    toast(e.message, true);
  }
});

/* ---------- table actions (event delegation) ---------- */
$("#rows").addEventListener("click", async (ev) => {
  const btn = ev.target.closest("button[data-act]");
  if (!btn) return;
  const tr = btn.closest("tr");
  const id = tr.dataset.id;
  const p = products.find((x) => String(x.id) === id);
  const act = btn.dataset.act;

  try {
    if (act === "add" || act === "remove") {
      const units = Number(tr.querySelector(".adjust input").value);
      if (!Number.isInteger(units) || units < 1) return toast("Enter a whole number of units, 1 or more.", true);
      await api(`/products/${id}/stock`, { method: "PATCH", body: { change: act === "add" ? units : -units } });
      toast(`${act === "add" ? "Added" : "Removed"} ${units} × ${p.name}`);
      await refresh();
    } else if (act === "delete") {
      if (!confirm(`Delete "${p.name}"? This cannot be undone.`)) return;
      await api(`/products/${id}`, { method: "DELETE" });
      toast(`Deleted ${p.name}`);
      await refresh();
    } else if (act === "edit") {
      openEdit(p);
    }
  } catch (e) {
    toast(e.message, true);
    await refresh();
  }
});

/* ---------- edit dialog ---------- */
const dlg = $("#edit-dialog");
const editForm = $("#edit-form");

function openEdit(p) {
  for (const k of ["id", "sku", "name", "category", "quantity", "price", "reorder_level"]) editForm[k].value = p[k];
  $("#edit-error").hidden = true;
  dlg.showModal();
}
$("#edit-cancel").addEventListener("click", () => dlg.close());

editForm.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const { id, ...body } = Object.fromEntries(new FormData(editForm));
  try {
    await api(`/products/${id}`, { method: "PUT", body });
    dlg.close();
    toast("Saved changes");
    await refresh();
  } catch (e) {
    const box = $("#edit-error");
    box.textContent = e.message;
    box.hidden = false;
  }
});

/* ---------- search & filters (debounced, no page reload) ---------- */
let searchTimer;
$("#search").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadProducts, 200);
});
$("#cat-filter").addEventListener("change", loadProducts);
$("#low-only").addEventListener("change", loadProducts);

refresh();
