import { describe, expect, it } from "vitest";
import { createTestApp } from "../../../__tests__/helpers/app.js";

/**
 * The archive custom URL is readable forever and creatable never.
 *
 * Hand-typing `format=note&title=none` into a settings text field is the
 * problem smart collections replace. Removing it from the form is not the same
 * as removing it — an endpoint that still accepts it has not stopped offering
 * it — so the refusal lives in the schema and again in the service.
 */
describe("archive custom URLs", () => {
  it("refuses to create one", async () => {
    const { services } = createTestApp({ authenticated: true });

    await expect(
      services.customUrls.create({
        path: "/notes-only",
        targetType: "archive",
        archiveQuery: "format=note",
      }),
    ).rejects.toThrow(/smart collection/i);
  });

  it("still reads, lists, and deletes one that already exists", async () => {
    const { services } = createTestApp({ authenticated: true });

    // How a real legacy row exists: written before the create path was closed.
    const record = await services.paths.create({
      path: "/notes-only",
      kind: "archive",
      archiveQuery: "format=note&title=none",
    });

    const listed = await services.customUrls.list();
    expect(listed.map((entry) => entry.path)).toContain("notes-only");
    expect(
      listed.find((entry) => entry.path === "notes-only")?.targetType,
    ).toBe("archive");

    expect(await services.customUrls.delete(record.id)).toBe(true);
    expect(await services.paths.getByPath("/notes-only")).toBeNull();
  });
});
