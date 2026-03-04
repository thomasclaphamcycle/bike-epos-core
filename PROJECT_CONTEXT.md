# Project Context: Bike Shop EPOS

Bike Shop EPOS is a Node/Express + Prisma/PostgreSQL backend for retail sales, workshop jobs, hire bookings, and stock control, with a React POS UI planned next.

Current status: server is running, Prisma is connected, core catalog models (`Product`, `Variant`, `Barcode`) exist, and barcode lookup is working (returns name, SKU, and price).

Flow: Scanner -> POS -> API (Express) -> Prisma -> PostgreSQL.

Next priorities: inventory management, basket/cart, sales transactions, stock movements, workshop integration, external integrations (e.g. BookMyBikeIn), then POS frontend.
