// Edge-case tests. Start the server first (python app.py), then run: npm test
// Uses only Node's built-in test runner and fetch (Node 18+).
const test = require("node:test");
const assert = require("node:assert/strict");

const BASE = process.env.API_URL || "http://127.0.0.1:5000/api";
const call = async (path, method = "GET", body) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
};
const sku = "T-" + Date.now();

test("add product, then reject a duplicate Product ID", async () => {
  const a = await call("/products", "POST", { sku, name: "Test Widget", category: "Testing", quantity: 4, price: 9.5, reorder_level: 5 });
  assert.equal(a.status, 201);
  assert.equal(a.data.low_stock, true); // 4 <= 5
  const dup = await call("/products", "POST", { sku, name: "Again", category: "Testing" });
  assert.equal(dup.status, 409);
});

test("rejects negative quantity, negative price, missing and fractional values", async () => {
  assert.equal((await call("/products", "POST", { sku: sku + "a", name: "x", category: "y", quantity: -1 })).status, 400);
  assert.equal((await call("/products", "POST", { sku: sku + "b", name: "x", category: "y", price: -5 })).status, 400);
  assert.equal((await call("/products", "POST", { sku: "", name: "x", category: "y" })).status, 400);
  assert.equal((await call("/products", "POST", { sku: sku + "c", name: "x", category: "y", quantity: 2.5 })).status, 400);
});

test("search finds products by ID and returns an empty list for unknown ones", async () => {
  const hit = await call("/products?q=" + sku);
  assert.equal(hit.data.count, 1);
  const miss = await call("/products?q=zzz-does-not-exist");
  assert.equal(miss.status, 200);
  assert.equal(miss.data.count, 0);
});

test("reducing stock below zero is refused and stock is unchanged", async () => {
  const id = (await call("/products?q=" + sku)).data.products[0].id;
  const bad = await call(`/products/${id}/stock`, "PATCH", { change: -999 });
  assert.equal(bad.status, 409);
  assert.equal((await call("/products/" + id)).data.quantity, 4);
  const ok = await call(`/products/${id}/stock`, "PATCH", { change: -4 });
  assert.equal(ok.data.quantity, 0);
});

test("update price, then delete; missing records return 404", async () => {
  const id = (await call("/products?q=" + sku)).data.products[0].id;
  assert.equal((await call("/products/" + id, "PUT", { price: 12 })).data.price, 12);
  assert.equal((await call("/products/" + id, "DELETE")).status, 200);
  assert.equal((await call("/products/" + id)).status, 404);
  assert.equal((await call("/products/" + id, "DELETE")).status, 404);
});
