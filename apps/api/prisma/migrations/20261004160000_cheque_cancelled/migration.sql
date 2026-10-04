-- A cheque taken on an invoice that is later edited or cancelled is marked cancelled (never deleted).
ALTER TABLE cheques DROP CONSTRAINT cheques_status;
ALTER TABLE cheques ADD CONSTRAINT cheques_status CHECK (status IN ('pending', 'cleared', 'bounced', 'cancelled'));
