const ensureMainLocationId = async (prisma) => {
  const existing = await prisma.location.findFirst({
    where: {
      code: {
        equals: "MAIN",
        mode: "insensitive",
      },
    },
    orderBy: { createdAt: "asc" },
  });

  if (existing) {
    return existing.id;
  }

  const created = await prisma.location.create({
    data: {
      name: "Main",
      code: "MAIN",
      isActive: true,
    },
  });

  return created.id;
};

module.exports = {
  ensureMainLocationId,
};
