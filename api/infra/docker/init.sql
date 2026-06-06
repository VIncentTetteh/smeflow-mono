-- Extensions (TimescaleDB is already loaded by the image)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create application role with restricted privileges
-- (audit_logs will have UPDATE/DELETE revoked after migration)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'smeflow_app') THEN
    CREATE ROLE smeflow_app LOGIN PASSWORD 'smeflow';
  END IF;
END$$;

GRANT CONNECT ON DATABASE smeflow TO smeflow_app;
GRANT USAGE ON SCHEMA public TO smeflow_app;
