import type { Money } from './money.interface';

/** Thrown by `assertValidMoney()` — lists every violation found, not just the first. */
export class InvalidMoneyError extends Error {
  constructor(public readonly reasons: readonly string[]) {
    super(`Invalid Money:\n${reasons.map((r) => `  - ${r}`).join('\n')}`);
    this.name = 'InvalidMoneyError';
  }
}

/**
 * Format check only — three uppercase ASCII letters — not membership in the
 * real ISO 4217 code list. Embedding and maintaining the full list here would
 * be its own maintenance burden and would drift; a format check catches the
 * actual bug class this exists for (a float slipping through, a lowercase or
 * malformed code from a bad integration) without pretending to validate
 * against an authority this module doesn't own.
 */
const ISO_4217_SHAPE = /^[A-Z]{3}$/;

export interface AssertValidMoneyOptions {
  /** Default `false` — most amounts (an invoice total, a payment) should never be negative. Pass `true` for a refund/ledger-adjustment context where a negative value is meaningful. */
  allowNegative?: boolean;
}

/**
 * The enforcement `localization-currency-standard.md`'s own "money is always
 * an integer minor-unit amount plus an explicit currency code" rule needs but
 * doesn't specify a mechanism for — call this at every boundary where a
 * `Money` value enters the system from outside (a DTO after deserialization,
 * a value read back from a legacy integration), not just where the type
 * happens to line up.
 */
export function assertValidMoney(money: Money, options: AssertValidMoneyOptions = {}): void {
  const reasons: string[] = [];

  if (!Number.isFinite(money.amountMinorUnits)) {
    reasons.push('amountMinorUnits is not a finite number');
  } else if (!Number.isInteger(money.amountMinorUnits)) {
    reasons.push('amountMinorUnits is not an integer — money is always minor units, never a float');
  } else if (!options.allowNegative && money.amountMinorUnits < 0) {
    reasons.push('amountMinorUnits is negative (pass { allowNegative: true } for a refund/adjustment context)');
  }

  if (typeof money.currency !== 'string' || !ISO_4217_SHAPE.test(money.currency)) {
    reasons.push(`currency "${String(money.currency)}" is not a 3-letter uppercase ISO 4217-shaped code`);
  }

  if (reasons.length > 0) throw new InvalidMoneyError(reasons);
}
