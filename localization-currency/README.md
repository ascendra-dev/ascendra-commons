# Localization and Currency Standard

Money, currency, and locale are represented so a market- and sector-agnostic
product doesn't accidentally get hardcoded to one market's currency and
language. No dependency on any other pattern in this library — self-contained.
No Model 1 / Model 2 split — this is a data-shape + validation convention, not
a swappable implementation (see `MODULE-STANDARD.md` §1b); the one genuinely
deferred capability (FX conversion) is called out below as the natural future
seam, not built speculatively ahead of a real need.

## The pattern

- **`Money`** — `{ amountMinorUnits: number; currency: string }`. Never a
  float. Never an implicit or globally-configured default currency — every
  monetary field carries its own currency code.
- **`assertValidMoney(money, { allowNegative? })`** — the enforcement the
  standard's own rule names but doesn't specify a mechanism for. Checks
  `amountMinorUnits` is a finite integer (rejects a float, `NaN`, `Infinity`,
  and — by default — a negative value) and `currency` is a 3-letter uppercase
  ISO-4217-*shaped* code (a format check, not membership in the real list —
  see the doc comment for why). Call this at every boundary a `Money` value
  enters the system from outside (after DTO deserialization, a value read back
  from a legacy integration), not just where the TypeScript type happens to
  line up.
- **`minorUnitsToDecimal` / `decimalToMinorUnits`** — correct conversion for
  *any* currency, not just the common 2-decimal case. **Not every currency has
  2 minor-unit digits** — JPY has 0, KWD/BHD/OMR have 3. Deliberately **not**
  derived from `Intl.NumberFormat` — that API's `maximumFractionDigits` is a
  CLDR *display/rounding* convention, which diverges from ISO 4217's formal
  minor-unit exponent for several currencies whose smallest coin has fallen
  out of practical use. **PKR is exactly this case**: ISO 4217 gives it 2
  (paisa), matching this document's own worked example, but `Intl` reports 0
  in Node's ICU data — using it would have silently miscalculated every PKR
  amount by a factor of 100 (caught by this module's own tests during
  development, not assumed away). `minorUnitDigits()` instead hardcodes the
  small, stable ISO 4217 exception lists (0-decimal and 3-decimal
  currencies), defaulting to 2.
- **`sameCurrency` / `assertSameCurrency`** — the primitive a project's own
  payment logic uses to reject a currency mismatch (e.g. a payment attempt
  against an invoice in a different currency) rather than silently accepting
  or converting it. Phase 1 does no FX conversion at all (see below), so a
  mismatch should always be a rejection today.

## Currency and locale are resolved per-issuer, not globally

An issuer's default currency and locale are attributes of the issuer (tenant)
record, not an application-wide setting — nothing in this module assumes a
single currency per deployment.

## Frontend formatting

Date, number, and text formatting on the frontend use a standard i18n library
(e.g. `next-intl`) with locale resolved from the tenant/user's preference —
that's a frontend-project concern (`ascendra-ui` components are already built
for it), not something this backend-side module owns. `minorUnitsToDecimal`
above is the backend-side counterpart — for generating a value server-side
(a PDF invoice, an email body) where a full i18n library isn't already in play.

## Currency conversion — explicitly out of scope

No FX conversion or multi-currency settlement here. The only current
requirement is that nothing in the data model or code *assumes* a single
currency — actual conversion/settlement is a later, real capability, and
**that** is the natural point to introduce an interface (an
`ExchangeRateProvider`-style port, the same shape `payment-gateway-adapter`
already uses) — not built ahead of that need.

## Observability

Not applicable — there's no silent-failure mode here the way `idempotency-key`
had. `assertValidMoney`/`assertSameCurrency` fail loudly and synchronously at
the point of use; a consumer that wants to track how often either actually
fires can log from its own catch block.

## Consuming this module

Copy `localization-currency/` into `src/ascendra-commons/localization-currency/`.

## Depends on

Nothing beyond the JS/TS runtime's built-in `Intl`.
