/** Demo data: three users, two published products with indexed docs. No API keys needed. */
import { PrismaClient } from "@prisma/client";
import { seedDemoData } from "../src/server/seed.js";

const db = new PrismaClient();
await seedDemoData(db, console.log);
await db.$disconnect();
