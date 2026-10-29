CREATE TABLE documents (
  id INTEGER PRIMARY KEY,
  document_type TEXT NOT NULL CHECK (document_type IN ('purchase', 'sale')),
  document_number TEXT NOT NULL UNIQUE,
  document_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'finalized', 'voided')),
  party_name TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  subtotal_irr INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_irr >= 0),
  discount_irr INTEGER NOT NULL DEFAULT 0 CHECK (discount_irr >= 0),
  tax_irr INTEGER NOT NULL DEFAULT 0 CHECK (tax_irr >= 0),
  total_irr INTEGER NOT NULL DEFAULT 0 CHECK (total_irr >= 0),
  finalized_at TEXT,
  void_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX documents_type_date_idx ON documents(document_type, document_date DESC);
CREATE INDEX documents_status_idx ON documents(status);
CREATE TABLE document_items (
  id INTEGER PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE RESTRICT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0),
  unit_price_irr INTEGER NOT NULL CHECK (unit_price_irr >= 0),
  discount_type TEXT NOT NULL DEFAULT 'none' CHECK (discount_type IN ('none', 'fixed', 'percent')),
  discount_value INTEGER NOT NULL DEFAULT 0 CHECK (discount_value >= 0),
  tax_rate_bp INTEGER NOT NULL DEFAULT 0 CHECK (tax_rate_bp BETWEEN 0 AND 10000),
  gross_irr INTEGER NOT NULL CHECK (gross_irr >= 0),
  discount_irr INTEGER NOT NULL CHECK (discount_irr >= 0),
  tax_irr INTEGER NOT NULL CHECK (tax_irr >= 0),
  total_irr INTEGER NOT NULL CHECK (total_irr >= 0),
  unit_cost_snapshot_irr INTEGER CHECK (unit_cost_snapshot_irr IS NULL OR unit_cost_snapshot_irr >= 0),
  cost_status TEXT NOT NULL DEFAULT 'unknown' CHECK (cost_status IN ('known', 'estimated', 'unknown'))
);
CREATE INDEX document_items_document_idx ON document_items(document_id);
CREATE INDEX document_items_product_idx ON document_items(product_id);
CREATE TABLE inventory_movements (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE RESTRICT,
  document_item_id INTEGER NOT NULL REFERENCES document_items(id) ON DELETE RESTRICT,
  quantity_delta_milli INTEGER NOT NULL CHECK (quantity_delta_milli <> 0),
  event_type TEXT NOT NULL CHECK (event_type IN ('purchase', 'sale', 'void')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(document_item_id, event_type)
);
CREATE INDEX inventory_movements_product_idx ON inventory_movements(product_id, id);
