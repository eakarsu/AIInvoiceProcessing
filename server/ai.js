const https = require('https');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

function callOpenRouter(prompt, systemPrompt = 'You are an expert AP automation and invoice processing AI assistant.') {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      model: process.env.OPENROUTER_MODEL || 'anthropic/claude-haiku-4.5',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ],
      max_tokens: 2000,
      temperature: 0.3
    });

    const options = {
      hostname: 'openrouter.ai',
      path: '/api/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'http://localhost:3001',
        'X-Title': 'AI Invoice Processing'
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (parsed.error) {
            resolve({ success: false, error: parsed.error.message || 'API error', raw: parsed });
          } else {
            const content = parsed.choices?.[0]?.message?.content || 'No response';
            resolve({
              success: true,
              content,
              model: parsed.model,
              usage: parsed.usage,
              raw: parsed
            });
          }
        } catch (e) {
          resolve({ success: false, error: 'Failed to parse response', raw: body });
        }
      });
    });

    req.on('error', (e) => {
      resolve({ success: false, error: e.message });
    });

    req.write(data);
    req.end();
  });
}

// AI Features for each module
const aiFeatures = {
  // Invoice AI Analysis
  async analyzeInvoice(invoice) {
    const prompt = `Analyze this invoice and provide insights:
Invoice #: ${invoice.invoice_number}
Vendor: ${invoice.vendor_name}
Amount: $${invoice.amount}
Status: ${invoice.status}
Due Date: ${invoice.due_date}
Description: ${invoice.description}
Line Items: ${JSON.stringify(invoice.line_items)}

Provide:
1. Risk assessment (low/medium/high)
2. Payment priority recommendation
3. Cost optimization suggestions
4. Any anomalies or red flags
5. Recommended actions

Format your response with clear sections and bullet points.`;
    return callOpenRouter(prompt);
  },

  // Vendor AI Analysis
  async analyzeVendor(vendor) {
    const prompt = `Analyze this vendor relationship and provide insights:
Vendor: ${vendor.name}
Category: ${vendor.category}
Rating: ${vendor.rating}/5
Total Invoices: ${vendor.total_invoices}
Total Spent: $${vendor.total_spent}
Payment Terms: ${vendor.payment_terms} days
Status: ${vendor.status}

Provide:
1. Vendor risk score (1-10)
2. Relationship health assessment
3. Negotiation leverage points
4. Cost optimization opportunities
5. Recommended actions for this vendor relationship

Format your response with clear sections and bullet points.`;
    return callOpenRouter(prompt);
  },

  // PO AI Analysis
  async analyzePurchaseOrder(po) {
    const prompt = `Analyze this purchase order:
PO #: ${po.po_number}
Vendor: ${po.vendor_name}
Amount: $${po.amount}
Status: ${po.status}
Items: ${JSON.stringify(po.items)}
Requested By: ${po.requested_by}
Delivery Date: ${po.delivery_date}

Provide:
1. Budget impact assessment
2. Pricing analysis (market comparison)
3. Approval recommendation (approve/reject/review)
4. Risk factors
5. Alternative vendor suggestions

Format your response with clear sections and bullet points.`;
    return callOpenRouter(prompt);
  },

  // Payment AI Analysis
  async analyzePayment(payment) {
    const prompt = `Analyze this payment:
Payment #: ${payment.payment_number}
Vendor: ${payment.vendor_name}
Amount: $${payment.amount}
Method: ${payment.method}
Status: ${payment.status}
Date: ${payment.payment_date}

Provide:
1. Payment timing optimization
2. Cash flow impact
3. Early payment discount opportunity
4. Payment method efficiency
5. Risk assessment

Format your response with clear sections and bullet points.`;
    return callOpenRouter(prompt);
  },

  // Approval AI Analysis
  async analyzeApproval(workflow) {
    const prompt = `Analyze this approval workflow:
Name: ${workflow.name}
Document Type: ${workflow.document_type}
Amount: $${workflow.amount}
Status: ${workflow.status}
Current Approver: ${workflow.current_approver}
Priority: ${workflow.priority}

Provide:
1. Approval urgency assessment
2. Bottleneck identification
3. Delegation recommendation
4. Compliance check
5. Process improvement suggestions

Format your response with clear sections and bullet points.`;
    return callOpenRouter(prompt);
  },

  // Budget AI Analysis
  async analyzeBudget(budget) {
    const prompt = `Analyze this budget:
Name: ${budget.name}
Department: ${budget.department}
Category: ${budget.category}
Allocated: $${budget.allocated_amount}
Spent: $${budget.spent_amount}
Remaining: $${budget.remaining_amount}
Status: ${budget.status}
Period: ${budget.fiscal_quarter} ${budget.fiscal_year}

Provide:
1. Burn rate analysis
2. Forecast to period end
3. Over/under spending risk
4. Reallocation suggestions
5. Cost saving opportunities

Format your response with clear sections and bullet points.`;
    return callOpenRouter(prompt);
  },

  // Receipt AI Extraction
  async analyzeReceipt(receipt) {
    const prompt = `Analyze this receipt/expense:
Receipt #: ${receipt.receipt_number}
Vendor: ${receipt.vendor_name}
Amount: $${receipt.amount}
Category: ${receipt.category}
Date: ${receipt.receipt_date}
Employee: ${receipt.employee}
Description: ${receipt.description}

Provide:
1. Expense policy compliance check
2. Category verification
3. Duplicate risk assessment
4. Tax deductibility analysis
5. Recommendations

Format your response with clear sections and bullet points.`;
    return callOpenRouter(prompt);
  },

  // Tax AI Analysis
  async analyzeTax(tax) {
    const prompt = `Analyze this tax record:
Tax Type: ${tax.tax_type}
Vendor: ${tax.vendor_name}
Amount: $${tax.amount}
Tax Amount: $${tax.tax_amount}
Tax Rate: ${tax.tax_rate}%
Period: ${tax.period}
Jurisdiction: ${tax.jurisdiction}
Status: ${tax.status}

Provide:
1. Tax compliance assessment
2. Rate verification
3. Filing deadline check
4. Optimization opportunities
5. Regulatory considerations

Format your response with clear sections and bullet points.`;
    return callOpenRouter(prompt);
  },

  // Report AI Summary
  async analyzeReport(report) {
    const prompt = `Provide executive insights for this report:
Report: ${report.name}
Type: ${report.report_type}
Period: ${report.date_range}
Summary: ${report.summary}

Provide:
1. Key takeaways
2. Trends and patterns
3. Areas of concern
4. Actionable recommendations
5. Strategic implications

Format your response with clear sections and bullet points.`;
    return callOpenRouter(prompt);
  },

  // Bank Reconciliation AI
  async analyzeReconciliation(recon) {
    const prompt = `Analyze this bank reconciliation:
Account: ${recon.account_name} (${recon.account_number})
Statement Date: ${recon.statement_date}
Statement Balance: $${recon.statement_balance}
Book Balance: $${recon.book_balance}
Difference: $${recon.difference}
Matched: ${recon.matched_transactions}
Unmatched: ${recon.unmatched_transactions}
Status: ${recon.status}

Provide:
1. Reconciliation status assessment
2. Root cause analysis for differences
3. Priority items to resolve
4. Process efficiency score
5. Recommendations

Format your response with clear sections and bullet points.`;
    return callOpenRouter(prompt);
  },

  // Credit Note AI
  async analyzeCreditNote(cn) {
    const prompt = `Analyze this credit note:
Credit Note #: ${cn.credit_note_number}
Vendor: ${cn.vendor_name}
Amount: $${cn.amount}
Reason: ${cn.reason}
Status: ${cn.status}
Issue Date: ${cn.issue_date}

Provide:
1. Validity assessment
2. Impact on vendor relationship
3. Cash flow impact
4. Pattern analysis (recurring credits)
5. Recommendations

Format your response with clear sections and bullet points.`;
    return callOpenRouter(prompt);
  },

  // Currency AI
  async analyzeCurrency(conversion) {
    const prompt = `Analyze this currency conversion:
From: ${conversion.from_currency}
To: ${conversion.to_currency}
Rate: ${conversion.exchange_rate}
Amount: ${conversion.amount}
Converted: $${conversion.converted_amount}
Date: ${conversion.conversion_date}

Provide:
1. Rate comparison to market
2. FX risk assessment
3. Hedging recommendation
4. Timing optimization
5. Cost savings opportunities

Format your response with clear sections and bullet points.`;
    return callOpenRouter(prompt);
  },

  // Duplicate Detection AI
  async analyzeDuplicate(dup) {
    const prompt = `Analyze this potential duplicate detection:
Invoice 1: ${dup.invoice_ref_1}
Invoice 2: ${dup.invoice_ref_2}
Vendor: ${dup.vendor_name}
Amount: $${dup.amount}
Similarity: ${dup.similarity_score}%
Method: ${dup.detection_method}
Status: ${dup.status}

Provide:
1. Duplicate probability assessment
2. Key differences to check
3. Resolution recommendation
4. Prevention suggestions
5. Financial impact if undetected

Format your response with clear sections and bullet points.`;
    return callOpenRouter(prompt);
  },

  // Audit Log AI
  async analyzeAuditLog(log) {
    const prompt = `Analyze this audit trail entry:
Action: ${log.action}
Entity: ${log.entity_type} #${log.entity_id}
User: ${log.user_name}
Details: ${log.details}
IP: ${log.ip_address}
Time: ${log.created_at}

Provide:
1. Compliance assessment
2. Risk level
3. Anomaly detection
4. Access pattern analysis
5. Security recommendations

Format your response with clear sections and bullet points.`;
    return callOpenRouter(prompt);
  },

  // Expense Category AI
  async analyzeExpenseCategory(cat) {
    const prompt = `Analyze this expense category:
Category: ${cat.name}
Code: ${cat.code}
Parent: ${cat.parent_category}
Budget Limit: $${cat.budget_limit}
Current Spend: $${cat.current_spend}
GL Account: ${cat.gl_account}

Provide:
1. Utilization analysis
2. Trend assessment
3. Benchmark comparison
4. Optimization opportunities
5. Recommendations

Format your response with clear sections and bullet points.`;
    return callOpenRouter(prompt);
  }
};

module.exports = { callOpenRouter, aiFeatures };
