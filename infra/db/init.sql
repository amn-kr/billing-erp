-- One-time database setup (run as a superuser, e.g. the RDS master user).
-- Change the passwords. Migrations run as erp_owner; the API runs as erp_app.
CREATE ROLE erp_owner LOGIN PASSWORD 'change-me-owner' CREATEDB;
CREATE ROLE erp_app LOGIN PASSWORD 'change-me-app';
CREATE DATABASE billing_erp OWNER erp_owner;
CREATE DATABASE billing_erp_test OWNER erp_owner;
