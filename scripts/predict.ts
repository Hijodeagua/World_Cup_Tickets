import { PrismaClient } from "@prisma/client";
import { computeAndStoreProjections } from "../lib/predictions/store";

const prisma = new PrismaClient();
const iterations = process.argv[2] ? Number(process.argv[2]) : undefined;

computeAndStoreProjections(prisma, iterations)
  .then((n) => console.log(`Projections recomputed for ${n} teams (${iterations ?? "default"} iterations).`))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
