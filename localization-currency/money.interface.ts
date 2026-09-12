/**
 * Money is always an integer minor-unit amount plus an explicit currency
 * code — never a float, never an implicit or globally-configured default
 * currency. Every monetary field carries its own currency code.
 */
export interface Money {
  /** e.g. 150000 = PKR 1,500.00. Integer — enforced by `assertValidMoney()`, never trusted by type alone. */
  amountMinorUnits: number;
  /** ISO 4217, e.g. 'PKR', 'USD'. */
  currency: string;
}
