/**
 * The Meridian Labs agreement as served by `read_document` (scenario 5).
 * Same text as scenarios/05-revenue-recognition/documents/meridian-labs-agreement.md
 * — inlined here so the runtime is self-contained (v1 has no DB; the doc is
 * part of the runtime contract). Keep the two in sync.
 */

export const MERIDIAN_DOCUMENT = `MASTER SALES AND SERVICES AGREEMENT

Between: Harbor Lane Instruments, Inc. ("HLI", "Seller")
And: Meridian Labs, Inc. ("Meridian", "Buyer")
Date: March 2, 2026
Contract value (itemized): USD 210,000 equipment purchase; USD 14,500 per
month calibration services; usage fees per Schedule A (USD 9,000 per month
minimum commitment)

1. EQUIPMENT
Seller shall sell and deliver one (1) XCal-4000 Automated Dilution and
Plating System (the "Equipment") at the purchase price of USD 210,000,
payable 50% on delivery and 50% net 30 after installation. Title transfers
on delivery; risk of loss passes on installation.

Installation and validation of the Equipment at Buyer's Novi, Michigan
facility shall be performed by Seller at no additional charge. Installation
consists of placement, calibration-grade leveling, and a validation run
against Seller's standard assay panel. The Equipment functions without the
validation run for routine lab work; Seller's standard practice is to
perform it before handover, and Seller refers to it internally as
"commissioning."

2. CALIBRATION-AS-A-SERVICE
Seller shall provide calibration and preventive-maintenance services for
the Equipment for a term of thirty-six (36) months from the installation
acceptance date, for a fee of USD 14,500 per month, invoiced monthly in
arrears.

Service includes quarterly on-site calibration, annual preventive
maintenance, and reasonable-availability telephone support.

3. USAGE-BASED CALIBRATION CONSUMABLES
In connection with the Services, Buyer shall pay a usage fee for
calibration consumables (reagent kits, dilution cassettes) at the per-kit
rates in Schedule A, invoiced monthly in arrears based on consumption
recorded by the Equipment's telemetry.

3.1 Minimum commitment. Buyer commits to a minimum of USD 9,000 of usage
fees per month (the "Monthly Floor"). If consumption in a calendar month
is below the Monthly Floor, Buyer shall pay the difference between the
Monthly Floor and actual usage fees for that month. Unused amounts of the
Monthly Floor do not roll over and are not credited against future months.

3.2 Repricing. On each anniversary of the installation acceptance date,
Seller may adjust the per-kit rates in Schedule A to Seller's then-standard
rates, provided the adjustment does not exceed ten percent (10%) in any
twelve-month period and Seller gives Buyer at least sixty (60) days'
written notice. If Buyer objects to an adjustment within that notice
period, the parties shall negotiate in good faith; if no agreement is
reached within thirty (30) days, either party may terminate the usage
component on ninety (90) days' notice, and upon such termination the
Monthly Floor under Section 3.1 shall cease to apply from the effective
date of termination.

3.3 Telemetry disputes. Consumption recorded by the Equipment's telemetry
is presumptively correct; Buyer may dispute a monthly statement within
fifteen (15) business days, failing which the statement is final.

4. PAYMENT; LATE CHARGES
Invoices are due net thirty (30). Late amounts accrue interest at the
lesser of 1.0% per month or the maximum lawful rate.

5. ACCEPTANCE
Buyer shall have ten (10) business days from installation to accept the
Equipment. Acceptance may be withheld only for material non-conformance
with the validation protocol in Section 1.

6. TERM; TERMINATION FOR CONVENIENCE
This Agreement begins on the installation acceptance date and continues
for the thirty-six (36) month service term. Buyer may terminate the
Services (Sections 2 and 3) for convenience on ninety (90) days' written
notice, subject to payment of an early-termination fee equal to the
Monthly Floor for the remaining months of the then-current contract year.

7. LIMITED WARRANTY; SERVICE LEVELS
Seller warrants the Equipment for twelve (12) months from acceptance.
During the service term, Seller shall meet the response times in Schedule
B; service-level failures entitle Buyer to a credit of up to 5% of the
monthly service fee per affected month, claimable on request.

8. DATA; TELEMETRY OWNERSHIP
Equipment telemetry is owned jointly: Seller may use telemetry to improve
consumable formulation and service planning; Buyer owns its lab-utilization
data. Seller shall not sell telemetry identifying Buyer to third parties.

9. GOVERNING LAW
Michigan law, without regard to conflicts principles.

SCHEDULE A: CONSUMABLES PRICING
RK-200  Dilution reagent kit         $310.00 per kit
DC-100  Dilution cassette pack (10)  $540.00 per pack
CV-50   Calibration verification kit $410.00 per kit

SCHEDULE B: SERVICE LEVELS
Instrument down      Response: 8 business hours   Resolution: 3 business days
Calibration overdue  Response: 5 business days    Resolution: 15 business days
`;
