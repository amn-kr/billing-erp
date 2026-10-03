-- Test databases for CI and local development (not for production — see init.sql).
CREATE ROLE erp_owner LOGIN PASSWORD 'erp_owner' CREATEDB;
CREATE ROLE erp_app LOGIN PASSWORD 'erp_app';
CREATE DATABASE billing_erp OWNER erp_owner;
CREATE DATABASE billing_erp_test OWNER erp_owner;
CREATE DATABASE billing_erp_e2e OWNER erp_owner;
