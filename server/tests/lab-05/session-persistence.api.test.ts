import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { hashPassword } from "../../src/auth.js";

describe("DB-backed sessions (survive restarts / multiple instances)", () => {
  const email = "session.test@example.com";
  const password = "Password123!";
  let token = "";

  beforeAll(async () => {
    await getPrisma().user.deleteMany({ where: { email } });
    await getPrisma().user.create({
      data: {
        name: "Session Test",
        email,
        passwordHash: hashPassword(password),
        role: "Requester",
        mustChangePassword: false,
        isActive: true,
      },
    });
    const res = await request(app).post("/api/auth/login").send({ email, password });
    token = res.body.token;
  });

  it("stores only a hash of the token in the database", async () => {
    const rows = await getPrisma().session.findMany({ where: { email } });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.tokenHash === token)).toBe(false);
  });

  it("accepts the token from the database (no in-memory state needed)", async () => {
    const res = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(email);
  });

  it("rejects an expired session", async () => {
    await getPrisma().session.updateMany({ where: { email }, data: { expiresAt: new Date(0) } });
    const res = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it("does not honour x-requester-id in production", async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const res = await request(app).get("/api/auth/me").set("x-requester-id", "1");
      expect(res.status).toBe(401);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});
