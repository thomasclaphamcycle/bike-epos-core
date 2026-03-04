# Migrations

This project uses Prisma Migrate.

## Development (interactive)
Use this when creating a new migration locally:

```bash
npx prisma migrate dev --name <migration_name>
```

## Non-interactive environments (CI/CD, servers)
Never use `migrate dev` in non-interactive environments.
Use:

```bash
npx prisma migrate deploy
```

`migrate deploy` applies all unapplied SQL migrations from `prisma/migrations` in order.

## Check migration consistency
Before/after deploy, you can verify migration state:

```bash
npx prisma migrate status
```

## Typical CI sequence
```bash
npx prisma migrate status
npx prisma migrate deploy
```
