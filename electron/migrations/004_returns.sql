CREATE TABLE returns (
  id INTEGER PRIMARY KEY,
  return_number TEXT NOT NULL UNIQUE,
  return_type TEXT NOT NULL CHECK (return_type IN ('purchase', 'sale')),
  source_document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE RESTRICT,
  return_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'finalized', 'voided')),
  reason TEXT NOT NULL,
  void_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  finalized_at TEXT
);
CREATE INDEX returns_source_idx ON returns(source_document_id, status);
CREATE TABLE return_items (
  id INTEGER PRIMARY KEY,
  return_id INTEGER NOT NULL REFERENCES returns(id) ON DELETE RESTRICT,
  source_document_item_id INTEGER NOT NULL REFERENCES document_items(id) ON DELETE RESTRICT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0),
  amount_irr INTEGER NOT NULL CHECK (amount_irr >= 0)
);
CREATE INDEX return_items_source_idx ON return_items(source_document_item_id);
CREATE TABLE return_movements (
  id INTEGER PRIMARY KEY,
  return_id INTEGER NOT NULL REFERENCES returns(id) ON DELETE RESTRICT,
  return_item_id INTEGER NOT NULL REFERENCES return_items(id) ON DELETE RESTRICT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity_delta_milli INTEGER NOT NULL CHECK (quantity_delta_milli <> 0),
  event_type TEXT NOT NULL DEFAULT 'return' CHECK (event_type IN ('return', 'void')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(return_item_id, event_type)
);
CREATE INDEX return_movements_product_idx ON return_movements(product_id, id);
