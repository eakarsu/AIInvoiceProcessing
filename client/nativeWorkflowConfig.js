window.nativeWorkflowConfig = {
  "title": "Invoice Processing",
  "features": [
    {
      "id": "three-way-match",
      "endpoint": "/invoices/:id/three-way-match",
      "title": "Three way match",
      "description": "Illustrative examples require source review. Native records, measurements, signatures and publication or approval controls retain their actual workflow.",
      "fields": [
        {
          "key": "id",
          "label": "Actual Invoices record",
          "resource": "invoices",
          "type": "text",
          "manual": true,
          "pathParameter": true,
          "required": true
        }
      ],
      "source": {
        "file": "server/index.js",
        "line": 355
      }
    },
    {
      "id": "duplicate-detection",
      "endpoint": "/invoices/:id/duplicate-detection",
      "title": "Duplicate detection",
      "description": "Illustrative examples require source review. Native records, measurements, signatures and publication or approval controls retain their actual workflow.",
      "fields": [
        {
          "key": "id",
          "label": "Actual Invoices record",
          "resource": "invoices",
          "type": "text",
          "manual": true,
          "pathParameter": true,
          "required": true
        }
      ],
      "source": {
        "file": "server/index.js",
        "line": 479
      }
    },
    {
      "id": "payment-term-advisor",
      "endpoint": "/vendors/:id/payment-term-advisor",
      "title": "Payment term advisor",
      "description": "Illustrative examples require source review. Native records, measurements, signatures and publication or approval controls retain their actual workflow.",
      "fields": [
        {
          "key": "id",
          "label": "Actual Vendors record",
          "resource": "vendors",
          "type": "text",
          "manual": true,
          "pathParameter": true,
          "required": true
        }
      ],
      "source": {
        "file": "server/index.js",
        "line": 531
      }
    },
    {
      "id": "forecast",
      "endpoint": "/budgets/forecast",
      "title": "Forecast",
      "description": "Illustrative examples require source review. Native records, measurements, signatures and publication or approval controls retain their actual workflow.",
      "fields": [
        {
          "key": "horizon",
          "type": "number",
          "required": false,
          "label": "Horizon",
          "presets": [
            6,
            8,
            9
          ],
          "manual": false
        }
      ],
      "source": {
        "file": "server/index.js",
        "line": 588
      }
    },
    {
      "id": "scorecard",
      "endpoint": "/vendors/:id/scorecard",
      "title": "Scorecard",
      "description": "Illustrative examples require source review. Native records, measurements, signatures and publication or approval controls retain their actual workflow.",
      "fields": [
        {
          "key": "id",
          "label": "Actual Vendors record",
          "resource": "vendors",
          "type": "text",
          "manual": true,
          "pathParameter": true,
          "required": true
        }
      ],
      "source": {
        "file": "server/index.js",
        "line": 645
      }
    },
    {
      "id": "record-analysis-invoices",
      "endpoint": "/invoices/:id/analyze",
      "title": "Invoices record review",
      "description": "Select an actual accessible record. Examples select an existing reference and do not create or change its stored facts. The native provider response remains advisory; approvals and mutations stay in the governed record workflow.",
      "fields": [
        {
          "key": "id",
          "label": "Actual Invoices record",
          "resource": "invoices",
          "type": "text",
          "manual": true,
          "pathParameter": true,
          "required": true
        }
      ],
      "source": {
        "file": "server/index.js",
        "line": 301
      }
    },
    {
      "id": "record-analysis-vendors",
      "endpoint": "/vendors/:id/analyze",
      "title": "Vendors record review",
      "description": "Select an actual accessible record. Examples select an existing reference and do not create or change its stored facts. The native provider response remains advisory; approvals and mutations stay in the governed record workflow.",
      "fields": [
        {
          "key": "id",
          "label": "Actual Vendors record",
          "resource": "vendors",
          "type": "text",
          "manual": true,
          "pathParameter": true,
          "required": true
        }
      ],
      "source": {
        "file": "server/index.js",
        "line": 302
      }
    },
    {
      "id": "record-analysis-purchase-orders",
      "endpoint": "/purchase-orders/:id/analyze",
      "title": "Purchase orders record review",
      "description": "Select an actual accessible record. Examples select an existing reference and do not create or change its stored facts. The native provider response remains advisory; approvals and mutations stay in the governed record workflow.",
      "fields": [
        {
          "key": "id",
          "label": "Actual Purchase orders record",
          "resource": "purchase-orders",
          "type": "text",
          "manual": true,
          "pathParameter": true,
          "required": true
        }
      ],
      "source": {
        "file": "server/index.js",
        "line": 303
      }
    },
    {
      "id": "record-analysis-payments",
      "endpoint": "/payments/:id/analyze",
      "title": "Payments record review",
      "description": "Select an actual accessible record. Examples select an existing reference and do not create or change its stored facts. The native provider response remains advisory; approvals and mutations stay in the governed record workflow.",
      "fields": [
        {
          "key": "id",
          "label": "Actual Payments record",
          "resource": "payments",
          "type": "text",
          "manual": true,
          "pathParameter": true,
          "required": true
        }
      ],
      "source": {
        "file": "server/index.js",
        "line": 304
      }
    },
    {
      "id": "record-analysis-approvals",
      "endpoint": "/approvals/:id/analyze",
      "title": "Approvals record review",
      "description": "Select an actual accessible record. Examples select an existing reference and do not create or change its stored facts. The native provider response remains advisory; approvals and mutations stay in the governed record workflow.",
      "fields": [
        {
          "key": "id",
          "label": "Actual Approvals record",
          "resource": "approvals",
          "type": "text",
          "manual": true,
          "pathParameter": true,
          "required": true
        }
      ],
      "source": {
        "file": "server/index.js",
        "line": 305
      }
    },
    {
      "id": "record-analysis-expense-categories",
      "endpoint": "/expense-categories/:id/analyze",
      "title": "Expense categories record review",
      "description": "Select an actual accessible record. Examples select an existing reference and do not create or change its stored facts. The native provider response remains advisory; approvals and mutations stay in the governed record workflow.",
      "fields": [
        {
          "key": "id",
          "label": "Actual Expense categories record",
          "resource": "expense-categories",
          "type": "text",
          "manual": true,
          "pathParameter": true,
          "required": true
        }
      ],
      "source": {
        "file": "server/index.js",
        "line": 306
      }
    },
    {
      "id": "record-analysis-budgets",
      "endpoint": "/budgets/:id/analyze",
      "title": "Budgets record review",
      "description": "Select an actual accessible record. Examples select an existing reference and do not create or change its stored facts. The native provider response remains advisory; approvals and mutations stay in the governed record workflow.",
      "fields": [
        {
          "key": "id",
          "label": "Actual Budgets record",
          "resource": "budgets",
          "type": "text",
          "manual": true,
          "pathParameter": true,
          "required": true
        }
      ],
      "source": {
        "file": "server/index.js",
        "line": 307
      }
    },
    {
      "id": "record-analysis-receipts",
      "endpoint": "/receipts/:id/analyze",
      "title": "Receipts record review",
      "description": "Select an actual accessible record. Examples select an existing reference and do not create or change its stored facts. The native provider response remains advisory; approvals and mutations stay in the governed record workflow.",
      "fields": [
        {
          "key": "id",
          "label": "Actual Receipts record",
          "resource": "receipts",
          "type": "text",
          "manual": true,
          "pathParameter": true,
          "required": true
        }
      ],
      "source": {
        "file": "server/index.js",
        "line": 308
      }
    },
    {
      "id": "record-analysis-tax-records",
      "endpoint": "/tax-records/:id/analyze",
      "title": "Tax records record review",
      "description": "Select an actual accessible record. Examples select an existing reference and do not create or change its stored facts. The native provider response remains advisory; approvals and mutations stay in the governed record workflow.",
      "fields": [
        {
          "key": "id",
          "label": "Actual Tax records record",
          "resource": "tax-records",
          "type": "text",
          "manual": true,
          "pathParameter": true,
          "required": true
        }
      ],
      "source": {
        "file": "server/index.js",
        "line": 309
      }
    },
    {
      "id": "record-analysis-reports",
      "endpoint": "/reports/:id/analyze",
      "title": "Reports record review",
      "description": "Select an actual accessible record. Examples select an existing reference and do not create or change its stored facts. The native provider response remains advisory; approvals and mutations stay in the governed record workflow.",
      "fields": [
        {
          "key": "id",
          "label": "Actual Reports record",
          "resource": "reports",
          "type": "text",
          "manual": true,
          "pathParameter": true,
          "required": true
        }
      ],
      "source": {
        "file": "server/index.js",
        "line": 310
      }
    },
    {
      "id": "record-analysis-bank-reconciliations",
      "endpoint": "/bank-reconciliations/:id/analyze",
      "title": "Bank reconciliations record review",
      "description": "Select an actual accessible record. Examples select an existing reference and do not create or change its stored facts. The native provider response remains advisory; approvals and mutations stay in the governed record workflow.",
      "fields": [
        {
          "key": "id",
          "label": "Actual Bank reconciliations record",
          "resource": "bank-reconciliations",
          "type": "text",
          "manual": true,
          "pathParameter": true,
          "required": true
        }
      ],
      "source": {
        "file": "server/index.js",
        "line": 311
      }
    },
    {
      "id": "record-analysis-credit-notes",
      "endpoint": "/credit-notes/:id/analyze",
      "title": "Credit notes record review",
      "description": "Select an actual accessible record. Examples select an existing reference and do not create or change its stored facts. The native provider response remains advisory; approvals and mutations stay in the governed record workflow.",
      "fields": [
        {
          "key": "id",
          "label": "Actual Credit notes record",
          "resource": "credit-notes",
          "type": "text",
          "manual": true,
          "pathParameter": true,
          "required": true
        }
      ],
      "source": {
        "file": "server/index.js",
        "line": 312
      }
    },
    {
      "id": "record-analysis-currency-conversions",
      "endpoint": "/currency-conversions/:id/analyze",
      "title": "Currency conversions record review",
      "description": "Select an actual accessible record. Examples select an existing reference and do not create or change its stored facts. The native provider response remains advisory; approvals and mutations stay in the governed record workflow.",
      "fields": [
        {
          "key": "id",
          "label": "Actual Currency conversions record",
          "resource": "currency-conversions",
          "type": "text",
          "manual": true,
          "pathParameter": true,
          "required": true
        }
      ],
      "source": {
        "file": "server/index.js",
        "line": 313
      }
    },
    {
      "id": "record-analysis-duplicate-detections",
      "endpoint": "/duplicate-detections/:id/analyze",
      "title": "Duplicate detections record review",
      "description": "Select an actual accessible record. Examples select an existing reference and do not create or change its stored facts. The native provider response remains advisory; approvals and mutations stay in the governed record workflow.",
      "fields": [
        {
          "key": "id",
          "label": "Actual Duplicate detections record",
          "resource": "duplicate-detections",
          "type": "text",
          "manual": true,
          "pathParameter": true,
          "required": true
        }
      ],
      "source": {
        "file": "server/index.js",
        "line": 314
      }
    },
    {
      "id": "record-analysis-audit-logs",
      "endpoint": "/audit-logs/:id/analyze",
      "title": "Audit logs record review",
      "description": "Select an actual accessible record. Examples select an existing reference and do not create or change its stored facts. The native provider response remains advisory; approvals and mutations stay in the governed record workflow.",
      "fields": [
        {
          "key": "id",
          "label": "Actual Audit logs record",
          "resource": "audit-logs",
          "type": "text",
          "manual": true,
          "pathParameter": true,
          "required": true
        }
      ],
      "source": {
        "file": "server/index.js",
        "line": 315
      }
    },
    {
      "id": "invoice-ocr",
      "endpoint": "/invoices/ocr-upload",
      "title": "Invoice image extraction",
      "description": "Choose an actual invoice image. Examples cannot create or replace source files. The native provider returns an unverified extraction candidate; deterministic validation and the governed approval workflow remain required before saving an invoice.",
      "fields": [
        {
          "key": "file",
          "label": "Actual invoice image",
          "type": "file",
          "required": true,
          "manual": true,
          "accept": "image/jpeg,image/png"
        }
      ],
      "source": {
        "file": "server/index.js",
        "line": 318
      }
    }
  ],
  "resources": [
    {
      "key": "invoices",
      "endpoint": "/invoices",
      "label": "Invoices",
      "fields": [],
      "delete": false,
      "source": "Existing authenticated resource API; record mutations remain in native governed screens."
    },
    {
      "key": "vendors",
      "endpoint": "/vendors",
      "label": "Vendors",
      "fields": [],
      "delete": false,
      "source": "Existing authenticated resource API; record mutations remain in native governed screens."
    },
    {
      "key": "purchase-orders",
      "endpoint": "/purchase-orders",
      "label": "Purchase orders",
      "fields": [],
      "delete": false,
      "source": "Existing authenticated resource API; record mutations remain in native governed screens."
    },
    {
      "key": "payments",
      "endpoint": "/payments",
      "label": "Payments",
      "fields": [],
      "delete": false,
      "source": "Existing authenticated resource API; record mutations remain in native governed screens."
    },
    {
      "key": "approvals",
      "endpoint": "/approvals",
      "label": "Approvals",
      "fields": [],
      "delete": false,
      "source": "Existing authenticated resource API; record mutations remain in native governed screens."
    },
    {
      "key": "expense-categories",
      "endpoint": "/expense-categories",
      "label": "Expense categories",
      "fields": [],
      "delete": false,
      "source": "Existing authenticated resource API; record mutations remain in native governed screens."
    },
    {
      "key": "budgets",
      "endpoint": "/budgets",
      "label": "Budgets",
      "fields": [],
      "delete": false,
      "source": "Existing authenticated resource API; record mutations remain in native governed screens."
    },
    {
      "key": "receipts",
      "endpoint": "/receipts",
      "label": "Receipts",
      "fields": [],
      "delete": false,
      "source": "Existing authenticated resource API; record mutations remain in native governed screens."
    },
    {
      "key": "tax-records",
      "endpoint": "/tax-records",
      "label": "Tax records",
      "fields": [],
      "delete": false,
      "source": "Existing authenticated resource API; record mutations remain in native governed screens."
    },
    {
      "key": "reports",
      "endpoint": "/reports",
      "label": "Reports",
      "fields": [],
      "delete": false,
      "source": "Existing authenticated resource API; record mutations remain in native governed screens."
    },
    {
      "key": "bank-reconciliations",
      "endpoint": "/bank-reconciliations",
      "label": "Bank reconciliations",
      "fields": [],
      "delete": false,
      "source": "Existing authenticated resource API; record mutations remain in native governed screens."
    },
    {
      "key": "credit-notes",
      "endpoint": "/credit-notes",
      "label": "Credit notes",
      "fields": [],
      "delete": false,
      "source": "Existing authenticated resource API; record mutations remain in native governed screens."
    },
    {
      "key": "currency-conversions",
      "endpoint": "/currency-conversions",
      "label": "Currency conversions",
      "fields": [],
      "delete": false,
      "source": "Existing authenticated resource API; record mutations remain in native governed screens."
    },
    {
      "key": "duplicate-detections",
      "endpoint": "/duplicate-detections",
      "label": "Duplicate detections",
      "fields": [],
      "delete": false,
      "source": "Existing authenticated resource API; record mutations remain in native governed screens."
    },
    {
      "key": "audit-logs",
      "endpoint": "/audit-logs",
      "label": "Audit logs",
      "fields": [],
      "delete": false,
      "source": "Existing authenticated resource API; record mutations remain in native governed screens."
    }
  ]
};
