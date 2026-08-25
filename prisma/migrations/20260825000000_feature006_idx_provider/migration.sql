-- Feature 006 Phase 2: additive enum capability only.
-- No provider, permission, Customer, token, or payload authority is introduced here.

ALTER TYPE "ManagedHttpMethod" ADD VALUE IF NOT EXISTS 'GET';
ALTER TYPE "ManagedPermissionMode" ADD VALUE IF NOT EXISTS 'provider_trusted';
