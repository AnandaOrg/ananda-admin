-- The audit log is permanent: entries can be added, never changed or removed (FR-ADM-2).
CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_change BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
--> statement-breakpoint
-- Commercial invoice numbers are sequential without gaps; a document number is never reused.
CREATE UNIQUE INDEX documents_number_uq ON documents (type, number) WHERE number IS NOT NULL;
