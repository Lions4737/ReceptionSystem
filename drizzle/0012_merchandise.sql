CREATE TABLE merchandise_products (
 id TEXT PRIMARY KEY, event_namespace TEXT NOT NULL, name TEXT NOT NULL,
 price INTEGER NOT NULL CHECK(price BETWEEN 0 AND 1000000), created_at INTEGER NOT NULL
);
CREATE TABLE merchandise_sales (
 id TEXT PRIMARY KEY, event_namespace TEXT NOT NULL, product_id TEXT NOT NULL REFERENCES merchandise_products(id),
 quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 1000), unit_price INTEGER NOT NULL,
 actor TEXT NOT NULL, created_at INTEGER NOT NULL, voided_at INTEGER
);
CREATE INDEX merchandise_products_event ON merchandise_products(event_namespace);
CREATE INDEX merchandise_sales_event ON merchandise_sales(event_namespace, created_at);
