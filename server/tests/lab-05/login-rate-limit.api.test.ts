import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { hashPassword } from "../../src/auth.js";

describe("Login rate limit (guards against password guessing)", () => {
  const email = "ratelimit.test@example.com";
  const password = "Password123!";
  const prevMax = process.env.LOGIN_MAX_ATTEMPTS;

  const login = (pw: string) => request(app).post("/api/auth/login").send({ email, password: pw });

  beforeAll(async () => {
    process.env.LOGIN_MAX_ATTEMPTS = "3";
    await getPrisma().loginAttempt.deleteMany({ where: { key: { endsWith: `|${email}` } } });
    await getPrisma().user.deleteMany({ where: { email } });
    await getPrisma().user.create({
      data: { name: "Rate Limit Test", email, passwordHash: hashPassword(password), role: "Requester", mustChangePassword: false, isActive: true },
    });
  });

  afterAll(async () => {
    if (prevMax === undefined) delete process.env.LOGIN_MAX_ATTEMPTS;
    else process.env.LOGIN_MAX_ATTEMPTS = prevMax;
    await getPrisma().loginAttempt.deleteMany({ where: { key: { endsWith: `|${email}` } } });
  });

  it("locks after the maximum number of wrong passwords, even for the right password", async () => {
    for (let i = 0; i < 3; i++) {
      expect((await login("wrong-password")).status).toBe(401);
    }
    const locked = await login("wrong-password");
    expect(locked.status).toBe(429);
    expect(Number(locked.headers["retry-after"])).toBeGreaterThan(0);

    const rightButLocked = await login(password);
    expect(rightButLocked.status).toBe(429);
  });

  it("lets the user in again once the lock has expired", async () => {
    await getPrisma().loginAttempt.updateMany({
      where: { key: { endsWith: `|${email}` } },
      data: { lockedUntil: new Date(Date.now() - 1000), windowStart: new Date(Date.now() - 60 * 60 * 1000) },
    });
    const res = await login(password);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("token");
  });

  it("a successful login clears earlier failures", async () => {
    expect((await login("wrong-password")).status).toBe(401);
    expect((await login(password)).status).toBe(200);
    const row = await getPrisma().loginAttempt.findFirst({ where: { key: { endsWith: `|${email}` } } });
    expect(row).toBeNull();
  });

  it("counts unknown emails too, so attackers cannot tell which accounts exist", async () => {
    const ghost = "does.not.exist@example.com";
    await getPrisma().loginAttempt.deleteMany({ where: { key: { endsWith: `|${ghost}` } } });
    for (let i = 0; i < 3; i++) {
      expect((await request(app).post("/api/auth/login").send({ email: ghost, password: "x" })).status).toBe(401);
    }
    expect((await request(app).post("/api/auth/login").send({ email: ghost, password: "x" })).status).toBe(429);
    await getPrisma().loginAttempt.deleteMany({ where: { key: { endsWith: `|${ghost}` } } });
  });
});
