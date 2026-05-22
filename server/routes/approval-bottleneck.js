const express = require('express');

const router = express.Router();

router.get('/', (_req, res) => {
  res.json({
    feature: 'Approval Bottleneck',
    summary: { blockedInvoices: 18, cashAtRisk: 246000, medianDelayDays: 4.7, urgentApprovers: 3 },
    queues: [
      { owner: 'Controller', invoices: 7, amount: 112000, delayDays: 5.4 },
      { owner: 'Procurement', invoices: 6, amount: 83000, delayDays: 3.8 },
      { owner: 'Department VP', invoices: 5, amount: 51000, delayDays: 6.2 },
    ],
    recommendations: [
      'Auto-escalate approvals older than three business days.',
      'Split low-risk invoices below policy threshold into batch approval.',
      'Prioritize vendors with early-pay discount windows expiring this week.',
    ],
  });
});

module.exports = router;
