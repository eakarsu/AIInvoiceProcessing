/**
 * Approval bottleneck: where pending approvals are stuck.
 *
 * This replaced a stub that returned hardcoded statistics. Every number below
 * is derived from `approval_workflows`; when nothing is pending the response
 * says so instead of inventing a queue.
 *
 *   GET /api/approval-bottleneck   queue + delay summary for pending approvals
 */
const { Router } = require('express');

function createApprovalBottleneckRouter(authMiddleware, pool) {
  const router = Router();

  router.get('/', authMiddleware, async (req, res) => {
    try {
      const rows = (await pool.query(
        `SELECT id, name, document_type, document_ref, amount, current_approver, priority,
                GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400))::int AS age_days
           FROM approval_workflows
          WHERE status IN ('pending', 'in_review')
          ORDER BY created_at ASC`
      )).rows;

      const amountOf = (value) => Number(value ?? 0);
      const ages = rows.map((r) => Number(r.age_days)).sort((a, b) => a - b);
      const median = ages.length === 0
        ? null
        : ages.length % 2
          ? ages[(ages.length - 1) / 2]
          : Number(((ages[ages.length / 2 - 1] + ages[ages.length / 2]) / 2).toFixed(1));

      const byOwner = new Map();
      for (const row of rows) {
        const owner = row.current_approver || 'Unassigned';
        const queue = byOwner.get(owner) || { owner, invoices: 0, amount: 0, ages: [] };
        queue.invoices += 1;
        queue.amount += amountOf(row.amount);
        queue.ages.push(Number(row.age_days));
        byOwner.set(owner, queue);
      }
      const queues = [...byOwner.values()]
        .map((queue) => ({
          owner: queue.owner,
          invoices: queue.invoices,
          amount: Number(queue.amount.toFixed(2)),
          delayDays: Number((queue.ages.reduce((a, b) => a + b, 0) / queue.ages.length).toFixed(1)),
        }))
        .sort((a, b) => b.delayDays - a.delayDays || b.amount - a.amount);

      const stale = rows.filter((r) => Number(r.age_days) > 3);
      const urgent = rows.filter((r) => String(r.priority || '').toLowerCase() === 'urgent');
      const urgentOwners = new Set([
        ...stale.map((r) => r.current_approver || 'Unassigned'),
        ...urgent.map((r) => r.current_approver || 'Unassigned'),
      ]);

      const recommendations = [];
      if (stale.length) recommendations.push(`Escalate ${stale.length} approval(s) pending more than three days.`);
      if (urgent.length) recommendations.push(`Review ${urgent.length} urgent-priority approval(s) first.`);
      if (!rows.length) recommendations.push('No approvals are pending; nothing needs escalation.');
      recommendations.push('This view never approves anything — each transition still requires an authorised decision in the workflow.');

      res.json({
        feature: 'Approval Bottleneck',
        summary: {
          blockedInvoices: rows.length,
          cashAtRisk: Number(rows.reduce((sum, r) => sum + amountOf(r.amount), 0).toFixed(2)),
          medianDelayDays: median,
          urgentApprovers: urgentOwners.size,
        },
        queues,
        recommendations,
        basis: 'Derived from approval_workflows rows with status pending or in_review; no sampled or estimated figures.',
        generatedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('approval-bottleneck error:', err);
      res.status(500).json({ error: err.message || 'Failed to compute approval bottleneck' });
    }
  });

  return router;
}

module.exports = createApprovalBottleneckRouter;
