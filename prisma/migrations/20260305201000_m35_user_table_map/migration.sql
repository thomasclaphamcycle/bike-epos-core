-- M35 follow-up: avoid reserved/mixed-case table name issues with adapter SQL generation.
ALTER TABLE "User" RENAME TO app_user;
