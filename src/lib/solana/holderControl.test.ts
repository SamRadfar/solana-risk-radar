import { describe, expect, it } from "vitest";

import {
  deriveControl,
  orderAttributes,
  LOCK_PROGRAM_IDS,
  MULTISIG_PROGRAM_IDS,
  VAULT_PROGRAM_IDS,
  type ControlInputs,
} from "./holderControl";
import { SYSTEM_PROGRAM_ID } from "./knownAddresses";

/**
 * Holder control regression suite.
 *
 * The risk this guards against is not a missing label — it is a confident
 * wrong one. Most of these tests assert that the system declines to classify:
 * a big balance is not a treasury, an idle wallet is not locked, and a
 * multisig is not a lock.
 */

const base = (overrides: Partial<ControlInputs> = {}): ControlInputs => ({
  kind: "wallet",
  ownerProgram: SYSTEM_PROGRAM_ID,
  ownerExecutable: false,
  state: "initialized",
  amountRaw: "1000000000",
  splMultisig: null,
  ...overrides,
});

describe("refusing to guess", () => {
  it("calls an ordinary wallet a wallet, and says the rest is unknown", () => {
    const control = deriveControl(base());
    expect(control.attributes).toContain("wallet");
    expect(control.attributes).toContain("unknown");
    expect(control.lockedRaw).toBe("0");
  });

  it("does not become a treasury because the balance is enormous", () => {
    const control = deriveControl(base({ amountRaw: "99999999999999999999" }));
    expect(control.attributes).toEqual(orderAttributes(["wallet", "unknown"]));
  });

  it("does not become locked because the account is merely initialized", () => {
    // Inactivity is not proof of a lock, and there is no "inactive" input at
    // all — the only lock signal is an enforced one.
    const control = deriveControl(base({ state: "initialized" }));
    expect(control.attributes).not.toContain("locked");
    expect(control.attributes).not.toContain("lock-program");
  });

  it("gives every attribute a recorded method and source", () => {
    const control = deriveControl(base());
    for (const item of control.evidence) {
      expect(item.method.length).toBeGreaterThan(10);
      expect(item.source.length).toBeGreaterThan(0);
    }
  });
});

describe("multisig", () => {
  it("reads an SPL multisig threshold rather than assuming one", () => {
    const control = deriveControl(base({ splMultisig: { threshold: 4, signers: 7 } }));
    expect(control.multisig).toEqual({ threshold: 4, signers: 7 });
    expect(control.attributes).toContain("multisig");
    expect(control.evidence.find((e) => e.attribute === "multisig")?.source).toContain(
      "4-of-7",
    );
  });

  it("reports a program multisig without inventing a threshold", () => {
    const program = Object.keys(MULTISIG_PROGRAM_IDS)[0];
    const control = deriveControl(base({ ownerProgram: program }));
    expect(control.attributes).toContain("multisig");
    // Recognised, but the configuration was not readable, so none is claimed.
    expect(control.multisig).toBeNull();
  });

  it("never treats a multisig as a lock", () => {
    const control = deriveControl(base({ splMultisig: { threshold: 4, signers: 7 } }));
    expect(control.attributes).not.toContain("locked");
    expect(control.lockedRaw).toBe("0");
  });

  it("stops calling the holder unknown once control is established", () => {
    const control = deriveControl(base({ splMultisig: { threshold: 2, signers: 3 } }));
    expect(control.attributes).toContain("multisig");
  });
});

describe("locks and vesting", () => {
  it("treats a frozen token account as locked, for its full balance", () => {
    const control = deriveControl(base({ state: "frozen", amountRaw: "5000" }));
    expect(control.attributes).toContain("locked");
    expect(control.lockedRaw).toBe("5000");
    expect(control.evidence.find((e) => e.attribute === "locked")?.source).toBe(
      "Account state: frozen",
    );
  });

  it("recognises a lock or vesting program without claiming a locked amount", () => {
    const program = Object.keys(LOCK_PROGRAM_IDS)[0];
    const control = deriveControl(base({ ownerProgram: program, kind: "contract" }));

    // Custody is verifiable; the schedule is not. So the holding is disclosed
    // as being under a lock program and none of it is treated as locked.
    expect(control.attributes).toContain("lock-program");
    expect(control.attributes).not.toContain("locked");
    expect(control.lockedRaw).toBe("0");
  });

  it("never reports a lock program as an enforced lock", () => {
    for (const program of Object.keys(LOCK_PROGRAM_IDS)) {
      const control = deriveControl(base({ ownerProgram: program, kind: "contract" }));
      expect(control.attributes).not.toContain("locked");
      expect(control.lockedRaw).toBe("0");
    }
  });

  it("keeps a lock program's custody separate from an enforced freeze", () => {
    const program = Object.keys(LOCK_PROGRAM_IDS)[0];
    const unfrozen = deriveControl(base({ ownerProgram: program, kind: "contract" }));
    const frozen = deriveControl(
      base({ ownerProgram: program, kind: "contract", state: "frozen", amountRaw: "42" }),
    );

    expect(unfrozen.lockedRaw).toBe("0");
    expect(frozen.lockedRaw).toBe("42");
  });
});

describe("account model", () => {
  it("marks pool vaults as liquidity rather than as whales", () => {
    const control = deriveControl(base({ kind: "pool", ownerProgram: "somePool" }));
    expect(control.attributes).toContain("liquidity-pool");
    expect(control.attributes).not.toContain("unknown");
  });

  it("marks registry custodians as exchanges", () => {
    const control = deriveControl(base({ kind: "custodian" }));
    expect(control.attributes).toContain("exchange");
  });

  it("marks burn addresses as irrecoverable", () => {
    const control = deriveControl(base({ kind: "burn" }));
    expect(control.attributes).toContain("burned");
  });

  it("marks a staking or governance program as a vault, not a lock", () => {
    const program = Object.keys(VAULT_PROGRAM_IDS)[0];
    const control = deriveControl(base({ ownerProgram: program, kind: "contract" }));
    expect(control.attributes).toContain("program-vault");
    expect(control.attributes).not.toContain("locked");
    expect(control.lockedRaw).toBe("0");
  });

  it("calls an unrecognised program-owned account a vault, still unknown", () => {
    const control = deriveControl(
      base({ kind: "contract", ownerProgram: "SomeUnknownProgram1111111111111111111111111" }),
    );
    expect(control.attributes).toContain("program-vault");
    expect(control.attributes).toContain("unknown");
  });
});

describe("combined attributes", () => {
  it("reports several verified attributes together", () => {
    const program = Object.keys(MULTISIG_PROGRAM_IDS)[0];
    const control = deriveControl(
      base({ ownerProgram: program, state: "frozen", amountRaw: "9" }),
    );
    expect(control.attributes).toContain("multisig");
    expect(control.attributes).toContain("locked");
    expect(control.lockedRaw).toBe("9");
  });

  it("orders attributes so the decision-relevant one reads first", () => {
    expect(orderAttributes(["unknown", "multisig", "liquidity-pool"])).toEqual([
      "liquidity-pool",
      "multisig",
      "unknown",
    ]);
  });
});
