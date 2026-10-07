# 📦 StockPilot — Inventory Management System

StockPilot is a full-stack web app for tracking product stock. You can add products, search them, adjust stock up or down, edit details and delete records, all without reloading the page. Items at or below their **reorder level** are highlighted and counted in a low-stock alert banner, and every stock change is written to a **stock activity log**.

## Features

- **Add / View / Update / Delete** products (Product ID, Name, Category, Quantity, Price)
- **Live search** by Product ID, name or category, plus category filter and a "low stock only" toggle
- **Low-stock alerts**: per-product reorder level, highlighted rows, "low"/"out" badges, summary banner
- **Stock adjust buttons** (− / +) that refuse to take stock below zero
- **Stock activity log** (kept even after a product is deleted)
- **Dashboard stats**: products, units, total stock value, items needing reorder
- **Validation** on client and server: non-negative whole-number quantity, non-negative price, required fields, unique Product ID

## Technologies used

| Part | Tool |
|---|---|
| Frontend | HTML5, CSS3, vanilla JavaScript (Fetch API) |
| Frontend tooling | Node.js: static dev server, Prettier, built-in test runner |
| Backend | Python 3 + Flask (REST API with CORS) |
| Database | SQLite (Python `sqlite3`) |

## Project structure

```
stockpilot/
├── backend/                 # Flask REST API  (http://127.0.0.1:5000)
│   ├── app.py               # routes, validation, SQLite schema
│   └── requirements.txt
├── frontend/                # UI + Node.js tooling  (http://localhost:3000)
│   ├── index.html
│   ├── style.css
│   ├── app.js               # Fetch API calls + DOM rendering
│   ├── server.js            # tiny Node static server
│   ├── package.json
│   └── test/api.test.js     # edge-case tests
└── README.md
```

The frontend and backend run as **two separate servers**. The frontend sends JSON over HTTP to the backend, and the backend allows this with CORS headers.

## How to run

**Prerequisites:** Python 3.9+ and Node.js 18+.

```bash
git clone https://github.com/<your-username>/stockpilot.git
cd stockpilot
```

**Terminal 1: backend**

```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

**Terminal 2: frontend**

```bash
cd frontend
npm start
```

Open **http://localhost:3000**. The SQLite file `inventory.db` is created automatically in `backend/` on first run.

If your backend uses a different address, edit `API_BASE` at the top of `frontend/app.js`.

### Run the tests

With the backend running:

```bash
cd frontend
npm test
```

### Format the code (optional)

```bash
cd frontend
npm install
npm run format
```

## Database schema

```sql
products  (id PK, sku UNIQUE, name, category,
           quantity CHECK >= 0, price CHECK >= 0,
           reorder_level CHECK >= 0, updated_at)

movements (id PK, sku, product_name, change, reason, created_at)
```

## REST API

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/products?q=&category=&low=1` | List / search products |
| GET | `/api/products/<id>` | Get one product |
| POST | `/api/products` | Add a product |
| PUT | `/api/products/<id>` | Update name, category, price, quantity, reorder level |
| PATCH | `/api/products/<id>/stock` | Add or remove stock: `{"change": -3}` |
| DELETE | `/api/products/<id>` | Delete a product |
| GET | `/api/stats` | Dashboard totals |
| GET | `/api/movements` | Recent stock activity |

Errors return JSON like `{"error": "Quantity cannot be negative."}` with status 400 (invalid input), 404 (not found) or 409 (duplicate ID / insufficient stock).

## Edge cases tested

| Case | Result |
|---|---|
| Search for a product that doesn't exist | 200 with empty list; UI shows "No products match your search" |
| Remove more stock than available | 409 "Only N in stock…", quantity unchanged |
| Negative quantity or price | 400 with message |
| Fractional quantity (2.5) | 400 "must be a whole number" |
| Duplicate Product ID | 409 |
| Update or delete a missing product | 404 |

## Author
**Name:** Tanushree Vaishnav  
**Roll No.:** 23  
**Section:** A  
**Department:** Electronics and Communication Engineering  
**Course:** Backend Technologies  
**Course Coordinator:** Rashmi Dagde
