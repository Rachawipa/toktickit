import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import fs from "fs";
import path from "path";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";

describe("Attachments are stored in PostgreSQL (survive redeploys)", () => {
  let requesterId = 0;
  let ticketId = 0;
  let attachmentId = 0;
  const content = Buffer.from("%PDF-1.4 db-stored attachment " + Date.now());

  beforeAll(async () => {
    const user = await getPrisma().user.findFirst({ where: { isActive: true, role: "Requester" }, orderBy: { id: "asc" } });
    requesterId = user!.id;
    await getPrisma().user.update({ where: { id: requesterId }, data: { mustChangePassword: false } });
    const cat = await getPrisma().category.findFirst();
    await getPrisma().attachment.deleteMany({ where: { ticket: { ticketNo: "TKT-TEST-ATTACH-DB" } } });
    await getPrisma().ticket.deleteMany({ where: { ticketNo: "TKT-TEST-ATTACH-DB" } });
    const t = await getPrisma().ticket.create({
      data: {
        ticketNo: "TKT-TEST-ATTACH-DB",
        requesterId,
        categoryId: cat!.id,
        relatedSystem: "Email",
        requestedPriority: "LOW",
        summary: "DB attachment",
        description: "Test",
      },
    });
    ticketId = t.id;
  });

  it("stores the bytes in the database, not on disk, and never returns them as JSON", async () => {
    const res = await request(app)
      .post(`/api/tickets/${ticketId}/attachments`)
      .set("X-Requester-Id", String(requesterId))
      .attach("file", content, { filename: "db.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(201);
    expect(res.body).not.toHaveProperty("data");
    attachmentId = res.body.id;

    const row = await getPrisma().attachment.findUnique({ where: { id: attachmentId } });
    expect(Buffer.from(row!.data!).equals(content)).toBe(true);
    expect(fs.existsSync(path.join(process.cwd(), "uploads", row!.filename))).toBe(false);
  });

  it("downloads the exact bytes with the right content type", async () => {
    const res = await request(app)
      .get(`/api/attachments/${attachmentId}`)
      .set("X-Requester-Id", String(requesterId))
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect((res.body as Buffer).equals(content)).toBe(true);
  });

  it("ticket detail lists attachments without the file bytes", async () => {
    const res = await request(app)
      .get(`/api/tickets/${ticketId}`)
      .set("X-Requester-Id", String(requesterId));
    expect(res.status).toBe(200);
    const att = (res.body.ticket ?? res.body).attachments;
    expect(att.length).toBeGreaterThan(0);
    expect(att[0]).not.toHaveProperty("data");
  });

  it("removing an attachment deletes its bytes", async () => {
    const res = await request(app)
      .delete(`/api/attachments/${attachmentId}`)
      .set("X-Requester-Id", String(requesterId))
      .send({ reason: "test cleanup" });
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("data");
    const row = await getPrisma().attachment.findUnique({ where: { id: attachmentId } });
    expect(row!.data).toBeNull();
    const dl = await request(app).get(`/api/attachments/${attachmentId}`).set("X-Requester-Id", String(requesterId));
    expect(dl.status).toBe(410);
  });
});
