import { describe, expect, it } from "vitest";
import type { CustomerRow } from "@koya/shared";
import { normalizeCustomerId, verifyIdentity } from "../src/verification.ts";

const amara: CustomerRow = {
  customer_id: "CUS-1001",
  company_name: "LagosLedger",
  contact_name: "Amara Okafor",
  contact_email: "amara@lagosledger.example",
  plan: "Growth",
  account_status: "active",
  region: "Nigeria",
  kyc_status: "approved",
  support_notes: "",
};

describe("verifyIdentity", () => {
  it("verifies first name + company (Scenario 3)", () => {
    expect(verifyIdentity({ contact_name: "Amara", company_name: "LagosLedger" }, amara).verified).toBe(true);
  });
  it("tolerates spoken spacing and case", () => {
    expect(verifyIdentity({ contact_name: "amara okafor", company_name: "Lagos Ledger" }, amara).verified).toBe(true);
  });
  it("requires two factors", () => {
    expect(verifyIdentity({ company_name: "LagosLedger" }, amara)).toMatchObject({ verified: false, matched: ["company_name"] });
  });
  it("fails when any supplied factor contradicts the record", () => {
    const r = verifyIdentity({ company_name: "LagosLedger", email: "amara@lagosledger.example", contact_name: "Daniel" }, amara);
    expect(r.verified).toBe(false);
    expect(r.mismatched).toEqual(["contact_name"]);
  });
  it("normalizes spoken customer IDs", () => {
    expect(normalizeCustomerId("cus 1001")).toBe("CUS-1001");
  });
});
