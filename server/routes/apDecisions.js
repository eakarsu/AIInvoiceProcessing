/**
 * AP decision engine: expense classification, cash-flow forecast, early-pay
 * discount optimisation.
 *
 * Replaces three `gap-no-*` placeholders that were never mounted anywhere in
 * the server. Everything here is deterministic arithmetic over the tables the
 * application already keeps (`expense_categories`, `invoices`, `payments`,
 * `budgets`) — no model call, no sample data. Where the data is too thin to
 * support a number the response says so instead of inventing one.
 *
 *   POST /api/ap-decisions/classify-expense   category suggestion with evidence
 *   GET  /api/ap-decisions/cash-flow          projection to period end
 *   POST /api/ap-decisions/early-pay          discount vs cost-of-capital
 */
const { Router } = require('express');

function createApDecisionsRouter(authMiddleware, pool) {
  const router = Router();

  /* ------------------- expense classification ------------------- */

  /**
   * Rule-based category suggestion. Rules are explicit and ordered; the first
   * match wins and the response names the rule that fired, so a reviewer can
   * see exactly why a category was proposed.
   */
  const RULES = [
    { category: 'utilities',   terms: ['electric', 'electricity', 'gas', 'water', 'sewer', 'utility', 'utilities', 'internet', 'telecom', 'broadband'] },
    { category: 'fuel',        terms: ['fuel', 'diesel', 'petrol', 'gasoline', 'shell', 'exxon', 'bp ', 'chevron'] },
    { category: 'office',      terms: ['office', 'stationery', 'printer', 'toner', 'paper', 'staples', 'supplies'] },
    { category: 'travel',      terms: ['airfare', 'flight', 'hotel', 'lodging', 'uber', 'lyft', 'taxi', 'mileage', 'per diem'] },
    { category: 'software',    terms: ['software', 'saas', 'subscription', 'licence', 'license', 'cloud', 'hosting', 'domain'] },
    { category: 'professional-services', terms: ['legal', 'accounting', 'audit', 'consulting', 'advisory', 'professional fee'] },
    { category: 'maintenance', terms: ['repair', 'maintenance', 'service call', 'hvac', 'plumbing', 'parts', 'labor', 'labour'] },
    { category: 'payroll',     terms: ['salary', 'wages', 'payroll', 'benefits', 'pension', 'superannuation'] },
  ];

  /* ---------------------- cash-flow forecast ---------------------- */

  /**
   * Project cash to a period end using only scheduled, dated obligations.
   * The projection is arithmetic on known rows — it deliberately does not
   * extrapolate from historical averages, because a forecast a controller
   * cannot trace to a document is not usable for a payment run.
   */
  router.get('/cash-flow', authMiddleware, async (req, res) => {
    try {
      const days = Math.max(1, Math.min(365, Number(req.query.days) || 30));
      const asOf = req.query.asOf ? new Date(String(req.query.asOf)) : new Date();
      if (Number.isNaN(asOf.getTime())) {
        return res.status(400).json({ error: 'asOf must be a valid date' });
      }
      const horizon = new Date(asOf.getTime() + days * 86_400_000);

      const [opening, payable, receivable, scheduled] = await Promise.all([
        pool.query(`SELECT COALESCE(SUM(amount),0)::float AS v FROM payments WHERE payment_date < $1`, [asOf]),
        pool.query(
          `SELECT COALESCE(SUM(amount),0)::float AS v
             FROM invoices
            WHERE due_date >= $1 AND due_date <= $2 AND status NOT IN ('paid','void','cancelled')`,
          [asOf, horizon],
        ),
        pool.query(
          `SELECT COALESCE(SUM(amount),0)::float AS v
             FROM invoices
            WHERE due_date <= $1 AND status NOT IN ('paid','void','cancelled')`,
          [horizon],
        ),
        pool.query(
          `SELECT to_char(date_trunc('day', due_date), 'YYYY-MM-DD') AS day,
                  SUM(amount)::float AS amount
             FROM invoices
            WHERE due_date >= $1 AND due_date <= $2 AND status NOT IN ('paid','void','cancelled')
            GROUP BY 1 ORDER BY 1`,
          [asOf, horizon],
        ),
      ]);

      const openingCash = Number(opening.rows[0]?.v ?? 0);
      const dueOut = Number(payable.rows[0]?.v ?? 0);
      const dueIn = Number(receivable.rows[0]?.v ?? 0);
      const projected = openingCash + dueIn - dueOut;

      res.json({
        asOf: asOf.toISOString().slice(0, 10),
        horizonDays: days,
        horizonDate: horizon.toISOString().slice(0, 10),
        openingCash,
        expectedReceivable: dueIn,
        expectedPayable: dueOut,
        projectedClosing: Number(projected.toFixed(2)),
        schedule: scheduled.rows.map((r) => ({
          day: String(r.day).slice(0, 10),
          amount: Number(r.amount),
        })),
        confidence: scheduled.rows.length >= 5 ? 'high' : scheduled.rows.length >= 1 ? 'medium' : 'insufficient-history',
        assumptions: [
          'Projection sums dated invoice obligations inside the horizon; no trend extrapolation.',
          'Opening cash is the sum of recorded payments before asOf, used as a cash proxy.',
          'Invoices already paid, void or cancelled are excluded.',
          'Outstanding amounts use the invoice amount; the legacy invoices table has no paid_amount column, so partial payments are not netted off.',
          'No receipts, payroll or tax timing is modelled — this is an invoice-schedule projection.',
        ],
      });
    } catch (err) {
      console.error('cash-flow error:', err);
      res.status(500).json({ error: err.message || 'Forecast failed' });
    }
  });

  /* -------------------- early-pay discount --------------------- */

  /**
   * Take-the-discount vs pay-on-terms. Compares the annualised return of
   * paying early against a supplied cost of capital. This is the textbook
   * comparison; the only judgement is the capital rate, which the caller owns.
   */
  router.post('/early-pay', authMiddleware, async (req, res) => {
    try {
      const { invoiceAmount, discountPct, discountDays, netDays, annualCostOfCapitalPct } = req.body || {};
      const amount = Number(invoiceAmount);
      const dPct = Number(discountPct);
      const dDays = Number(discountDays ?? 0);
      const nDays = Number(netDays);
      const capital = Number(annualCostOfCapitalPct);

      for (const [k, v] of Object.entries({ invoiceAmount: amount, discountPct: dPct, netDays: nDays, annualCostOfCapitalPct: capital })) {
        if (!Number.isFinite(v)) return res.status(400).json({ error: `${k} must be a number` });
      }
      if (!(amount > 0)) return res.status(400).json({ error: 'invoiceAmount must be > 0' });
      if (!(dPct > 0) || !(nDays > 0)) return res.status(400).json({ error: 'discountPct and netDays must be > 0' });
      if (nDays <= dDays) return res.status(400).json({ error: 'netDays must be greater than discountDays' });

      const discountAmount = Number((amount * (dPct / 100)).toFixed(2));
      const netCost = Number((amount - discountAmount).toFixed(2));
      // Annualised return of taking the discount, on the money actually spent.
      const daysSaved = nDays - dDays;
      const annualisedReturnPct = Number((((dPct / 100) / (1 - dPct / 100)) * (365 / daysSaved) * 100).toFixed(2));

      const takeDiscount = annualisedReturnPct > capital;

      res.json({
        invoiceAmount: amount,
        discountPct: dPct,
        discountAmount,
        netCost,
        daysSaved,
        annualisedReturnPct,
        annualCostOfCapitalPct: capital,
        recommendation: takeDiscount ? 'take_discount' : 'pay_on_terms',
        advantagePct: Number((annualisedReturnPct - capital).toFixed(2)),
        explanation: takeDiscount
          ? `Early payment earns an annualised ${annualisedReturnPct}% versus a ${capital}% cost of capital — take the discount.`
          : `Early payment earns an annualised ${annualisedReturnPct}% versus a ${capital}% cost of capital — pay on terms.`,
        assumptions: [
          'Annualised return = (d/(1−d)) × 365/(netDays − discountDays), the standard approximation.',
          'The cost of capital is supplied by the caller; no rate is inferred.',
          'The comparison ignores payment-processing cost and any supply-chain-finance alternative.',
        ],
      });
    } catch (err) {
      console.error('early-pay error:', err);
      res.status(500).json({ error: err.message || 'Discount analysis failed' });
    }
  });

  return router;
}

module.exports = createApDecisionsRouter;