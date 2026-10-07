"""StockPilot backend - REST API only (Flask + SQLite). The UI lives in ../frontend."""
import os
import sqlite3
from flask import Flask, jsonify, request, g

DB_PATH = os.environ.get("STOCKPILOT_DB", os.path.join(os.path.dirname(__file__), "inventory.db"))

app = Flask(__name__)

SCHEMA = """
CREATE TABLE IF NOT EXISTS products (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    sku           TEXT    NOT NULL UNIQUE COLLATE NOCASE,   -- the user-visible Product ID
    name          TEXT    NOT NULL,
    category      TEXT    NOT NULL,
    quantity      INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    price         REAL    NOT NULL DEFAULT 0 CHECK (price >= 0),
    reorder_level INTEGER NOT NULL DEFAULT 5 CHECK (reorder_level >= 0),
    updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
-- History is kept even after a product is deleted, so no foreign key here.
CREATE TABLE IF NOT EXISTS movements (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    sku          TEXT NOT NULL,
    product_name TEXT NOT NULL,
    change       INTEGER NOT NULL,
    reason       TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
"""

SELECT = "SELECT *, (quantity <= reorder_level) AS low_stock FROM products"


# ---------- database helpers ----------
def db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    conn = g.pop("db", None)
    if conn:
        conn.close()


def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(SCHEMA)
    conn.commit()
    conn.close()


def row(r):
    if r is None:
        return None
    d = dict(r)
    d["low_stock"] = bool(d["low_stock"])
    return d


def log_move(sku, name, change, reason):
    db().execute(
        "INSERT INTO movements (sku, product_name, change, reason) VALUES (?,?,?,?)",
        (sku, name, change, reason),
    )


# ---------- validation ----------
def to_int(v):
    """Return a whole number, or None if v is not one (bools and 2.5 are rejected)."""
    if isinstance(v, bool):
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return int(f) if f.is_integer() else None


def to_money(v):
    if isinstance(v, bool):
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return round(f, 2) if f == f and f != float("inf") else None


def validate(data, partial=False):
    """Validate product JSON. Returns (clean_dict, error_message_or_None)."""
    if not isinstance(data, dict):
        return None, "Request body must be a JSON object."
    out = {}
    for key, label in (("sku", "Product ID"), ("name", "Name"), ("category", "Category")):
        if key in data or not partial:
            val = str(data.get(key, "")).strip()
            if not val:
                return None, f"{label} is required."
            if len(val) > 60:
                return None, f"{label} must be 60 characters or fewer."
            out[key] = val
    if "quantity" in data or not partial:
        q = to_int(data.get("quantity", 0))
        if q is None:
            return None, "Quantity must be a whole number."
        if q < 0:
            return None, "Quantity cannot be negative."
        out["quantity"] = q
    if "price" in data or not partial:
        p = to_money(data.get("price", 0))
        if p is None:
            return None, "Price must be a number."
        if p < 0:
            return None, "Price cannot be negative."
        out["price"] = p
    if "reorder_level" in data or not partial:
        r = to_int(data.get("reorder_level", 5))
        if r is None:
            return None, "Reorder level must be a whole number."
        if r < 0:
            return None, "Reorder level cannot be negative."
        out["reorder_level"] = r
    return out, None


def err(msg, code=400):
    return jsonify({"error": msg}), code


# ---------- routes ----------
@app.after_request
def add_cors(resp):
    """Let the frontend (served from another port) call this API."""
    resp.headers["Access-Control-Allow-Origin"] = os.environ.get("FRONTEND_ORIGIN", "*")
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
    return resp


@app.get("/")
def index():
    return jsonify({"app": "StockPilot API", "docs": "see README.md", "products": "/api/products"})


@app.get("/api/products")
def list_products():
    q = request.args.get("q", "").strip()
    category = request.args.get("category", "").strip()
    low_only = request.args.get("low") in ("1", "true")
    sql, args, where = SELECT, [], []
    if q:
        where.append("(sku LIKE ? OR name LIKE ? OR category LIKE ?)")
        args += [f"%{q}%"] * 3
    if category:
        where.append("category = ? COLLATE NOCASE")
        args.append(category)
    if low_only:
        where.append("quantity <= reorder_level")
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY low_stock DESC, name COLLATE NOCASE"
    items = [row(r) for r in db().execute(sql, args)]
    return jsonify({"count": len(items), "products": items})


@app.get("/api/products/<int:pid>")
def get_product(pid):
    p = row(db().execute(SELECT + " WHERE id = ?", (pid,)).fetchone())
    return jsonify(p) if p else err("Product not found.", 404)


@app.post("/api/products")
def add_product():
    clean, e = validate(request.get_json(silent=True))
    if e:
        return err(e)
    try:
        cur = db().execute(
            "INSERT INTO products (sku, name, category, quantity, price, reorder_level) VALUES (?,?,?,?,?,?)",
            (clean["sku"], clean["name"], clean["category"], clean["quantity"], clean["price"], clean["reorder_level"]),
        )
    except sqlite3.IntegrityError:
        return err(f"Product ID '{clean['sku']}' already exists.", 409)
    if clean["quantity"]:
        log_move(clean["sku"], clean["name"], clean["quantity"], "initial stock")
    db().commit()
    p = row(db().execute(SELECT + " WHERE id = ?", (cur.lastrowid,)).fetchone())
    return jsonify(p), 201


@app.put("/api/products/<int:pid>")
def update_product(pid):
    cur = db().execute("SELECT * FROM products WHERE id = ?", (pid,)).fetchone()
    if not cur:
        return err("Product not found.", 404)
    clean, e = validate(request.get_json(silent=True), partial=True)
    if e:
        return err(e)
    if not clean:
        return err("Nothing to update.")
    sets = ", ".join(f"{k} = ?" for k in clean) + ", updated_at = datetime('now')"
    try:
        db().execute(f"UPDATE products SET {sets} WHERE id = ?", (*clean.values(), pid))
    except sqlite3.IntegrityError:
        return err(f"Product ID '{clean.get('sku')}' already exists.", 409)
    if "quantity" in clean and clean["quantity"] != cur["quantity"]:
        log_move(clean.get("sku", cur["sku"]), clean.get("name", cur["name"]),
                 clean["quantity"] - cur["quantity"], "manual correction")
    db().commit()
    return jsonify(row(db().execute(SELECT + " WHERE id = ?", (pid,)).fetchone()))


@app.patch("/api/products/<int:pid>/stock")
def adjust_stock(pid):
    """Add or remove stock. Body: {"change": -3, "reason": "sold"}"""
    cur = db().execute("SELECT * FROM products WHERE id = ?", (pid,)).fetchone()
    if not cur:
        return err("Product not found.", 404)
    body = request.get_json(silent=True) or {}
    change = to_int(body.get("change"))
    if change is None or change == 0:
        return err("Stock change must be a non-zero whole number.")
    new_qty = cur["quantity"] + change
    if new_qty < 0:
        return err(f"Only {cur['quantity']} in stock - cannot remove {abs(change)}.", 409)
    reason = str(body.get("reason") or ("restock" if change > 0 else "stock out"))[:60]
    db().execute("UPDATE products SET quantity = ?, updated_at = datetime('now') WHERE id = ?", (new_qty, pid))
    log_move(cur["sku"], cur["name"], change, reason)
    db().commit()
    return jsonify(row(db().execute(SELECT + " WHERE id = ?", (pid,)).fetchone()))


@app.delete("/api/products/<int:pid>")
def delete_product(pid):
    cur = db().execute("SELECT * FROM products WHERE id = ?", (pid,)).fetchone()
    if not cur:
        return err("Product not found.", 404)
    db().execute("DELETE FROM products WHERE id = ?", (pid,))
    log_move(cur["sku"], cur["name"], -cur["quantity"], "product deleted")
    db().commit()
    return jsonify({"deleted": pid})


@app.get("/api/stats")
def stats():
    r = db().execute(
        "SELECT COUNT(*) AS products, COALESCE(SUM(quantity),0) AS units, "
        "COALESCE(SUM(quantity*price),0) AS value, "
        "COALESCE(SUM(quantity <= reorder_level),0) AS low FROM products"
    ).fetchone()
    return jsonify(dict(r))


@app.get("/api/categories")
def categories():
    rows = db().execute("SELECT DISTINCT category FROM products ORDER BY category COLLATE NOCASE")
    return jsonify([r["category"] for r in rows])


@app.get("/api/movements")
def movements():
    rows = db().execute("SELECT * FROM movements ORDER BY id DESC LIMIT 15")
    return jsonify([dict(r) for r in rows])


init_db()

if __name__ == "__main__":
    app.run(debug=True, port=int(os.environ.get("PORT", 5000)))
