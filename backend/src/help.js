export const HELP = {
  title: "Analyst guide",
  sections: [
    { heading: "Reading a risk score", body: "Every transaction is scored 0-100 by the champion model. 91+ is Critical, 70-90 High, 40-69 Medium and below 40 Low. Scores at or above the review threshold (Models → Risk threshold) enter the analyst queue automatically." },
    { heading: "Investigating a signal", body: "Open any row to see the top contributing signals (SHAP-style factors), matched alert rules, the recommended action and the audit trail. Confirm fraud if the activity is malicious, or mark a false positive to teach the models." },
    { heading: "Alert rules", body: "Rules flag transactions regardless of score (for example amount ≥ ₹50,000 or impossible travel). Manage them from Alerts → Manage rules. Use Sync rules to re-evaluate the full history." },
    { heading: "Feedback loop", body: "Every decision you make is stored as labelled feedback. Retrain models (Models page) to include that feedback; promote a better performing model to champion when it beats the current one." },
    { heading: "Ingesting data", body: "Use Ingest data to start the live simulator, score a synthetic batch, or upload a CSV with at least 'merchant' and 'amount' columns. Production systems can POST to /api/ingest/transactions." },
  ],
};
