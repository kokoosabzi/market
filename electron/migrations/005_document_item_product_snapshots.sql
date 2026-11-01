ALTER TABLE document_items ADD COLUMN product_code_snapshot TEXT;
ALTER TABLE document_items ADD COLUMN product_name_snapshot TEXT;
ALTER TABLE document_items ADD COLUMN unit_snapshot TEXT;

UPDATE document_items
SET product_code_snapshot = (SELECT code FROM products WHERE products.id = document_items.product_id),
    product_name_snapshot = (SELECT name FROM products WHERE products.id = document_items.product_id),
    unit_snapshot = (SELECT unit FROM products WHERE products.id = document_items.product_id)
WHERE product_code_snapshot IS NULL
   OR product_name_snapshot IS NULL
   OR unit_snapshot IS NULL;

CREATE TRIGGER document_item_snapshot_immutable_after_finalize
BEFORE UPDATE OF product_code_snapshot, product_name_snapshot, unit_snapshot ON document_items
WHEN (SELECT status FROM documents WHERE id = OLD.document_id) <> 'draft'
BEGIN
  SELECT RAISE(ABORT, 'Finalized document item snapshots are immutable');
END;
