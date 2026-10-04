-- A bounced cheque keeps the bank's bounce charges (prototype bcm "Bank charges for the bounce").
ALTER TABLE cheques ADD COLUMN charges NUMERIC(14,2) NOT NULL DEFAULT 0;
