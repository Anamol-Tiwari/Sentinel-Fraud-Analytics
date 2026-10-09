import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  Cpu,
  Download,
  Eye,
  FileWarning,
  Filter,
  Gauge,
  Layers3,
  LayoutDashboard,
  ListFilter,
  MapPin,
  MoreHorizontal,
  Radio,
  RefreshCw,
  Search,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Upload,
  UserRound,
  X,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";

type RiskLevel = "Critical" | "High" | "Medium" | "Low";
type Decision = "Review" | "Confirmed fraud" | "False positive" | "Cleared";
type View = "Overview" | "Transactions" | "Alerts" | "Models";

const loggedInUser = {
  name: "Aditya Nair",
  initials: "AN",
  role: "Developer",
};

function getGreeting(date: Date): string {
  const hour = date.getHours();

  if (hour >= 4 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 16) return "Good afternoon";
  return "Good evening";
}

type Transaction = {
  id: string;
  time: string;
  merchant: string;
  category: string;
  location: string;
  amount: number;
  score: number;
  risk: RiskLevel;
  decision: Decision;
  method: string;
  device: string;
  anomaly: string;
  model: string;
  factors: { label: string; value: string; weight: number; tone: "danger" | "amber" | "lime" }[];
};

const transactions: Transaction[] = [
  {
    id: "TX-9842A",
    time: "Today · 10:42:18",
    merchant: "Nova Electronics",
    category: "Electronics",
    location: "Mumbai, IN",
    amount: 84200,
    score: 98,
    risk: "Critical",
    decision: "Review",
    method: "Card · •••• 4021",
    device: "Chrome · Windows",
    anomaly: "Velocity spike",
    model: "XGBoost v2.4",
    factors: [
      { label: "Unusual amount", value: "₹84,200 vs ₹4,850 avg", weight: 92, tone: "danger" },
      { label: "Velocity spike", value: "7 attempts in 18 min", weight: 84, tone: "amber" },
      { label: "New device", value: "First seen 12 min ago", weight: 68, tone: "lime" },
    ],
  },
  {
    id: "TX-9838F",
    time: "Today · 10:39:04",
    merchant: "CloudCart Pro",
    category: "SaaS",
    location: "Singapore, SG",
    amount: 12990,
    score: 94,
    risk: "Critical",
    decision: "Review",
    method: "Card · •••• 1198",
    device: "Safari · iPhone",
    anomaly: "Geo mismatch",
    model: "XGBoost v2.4",
    factors: [
      { label: "Geo mismatch", value: "Card issued in Delhi", weight: 90, tone: "danger" },
      { label: "IP reputation", value: "Known proxy network", weight: 78, tone: "amber" },
      { label: "Merchant shift", value: "First SaaS purchase", weight: 41, tone: "lime" },
    ],
  },
  {
    id: "TX-9829B",
    time: "Today · 10:31:47",
    merchant: "MetroRide Wallet",
    category: "Transport",
    location: "Bengaluru, IN",
    amount: 4850,
    score: 81,
    risk: "High",
    decision: "Review",
    method: "UPI · •••• 8824",
    device: "Android · App",
    anomaly: "Pattern deviation",
    model: "Random Forest",
    factors: [
      { label: "Pattern deviation", value: "Outside weekly rhythm", weight: 74, tone: "danger" },
      { label: "Amount cluster", value: "3 similar attempts", weight: 58, tone: "amber" },
      { label: "Session age", value: "Account created yesterday", weight: 39, tone: "lime" },
    ],
  },
  {
    id: "TX-9817C",
    time: "Today · 10:18:12",
    merchant: "FreshBasket Market",
    category: "Groceries",
    location: "Pune, IN",
    amount: 2360,
    score: 68,
    risk: "Medium",
    decision: "Review",
    method: "Card · •••• 7364",
    device: "Chrome · Android",
    anomaly: "Amount deviation",
    model: "Isolation Forest",
    factors: [
      { label: "Amount deviation", value: "2.2× personal average", weight: 55, tone: "amber" },
      { label: "Time anomaly", value: "Purchase at 03:18 local", weight: 42, tone: "amber" },
      { label: "Trusted device", value: "Seen 18 times", weight: 16, tone: "lime" },
    ],
  },
  {
    id: "TX-9804D",
    time: "Today · 09:54:28",
    merchant: "Orbit Telecom",
    category: "Utilities",
    location: "Hyderabad, IN",
    amount: 780,
    score: 44,
    risk: "Medium",
    decision: "Cleared",
    method: "Netbanking · HDFC",
    device: "Chrome · MacOS",
    anomaly: "Low confidence",
    model: "Isolation Forest",
    factors: [
      { label: "Time anomaly", value: "Outside normal window", weight: 31, tone: "amber" },
      { label: "Merchant history", value: "Known for 9 months", weight: 12, tone: "lime" },
      { label: "Device match", value: "Trusted device", weight: 8, tone: "lime" },
    ],
  },
  {
    id: "TX-9796E",
    time: "Today · 09:41:03",
    merchant: "Luma Travel",
    category: "Travel",
    location: "Chennai, IN",
    amount: 31800,
    score: 90,
    risk: "High",
    decision: "Review",
    method: "Card · •••• 2185",
    device: "Safari · iPad",
    anomaly: "Impossible travel",
    model: "XGBoost v2.4",
    factors: [
      { label: "Impossible travel", value: "Delhi → Chennai in 46 min", weight: 89, tone: "danger" },
      { label: "High-value purchase", value: "6.4× personal average", weight: 70, tone: "amber" },
      { label: "New merchant", value: "First purchase here", weight: 52, tone: "lime" },
    ],
  },
  {
    id: "TX-9788G",
    time: "Today · 09:22:56",
    merchant: "GreenLeaf Pharmacy",
    category: "Health",
    location: "Kolkata, IN",
    amount: 1860,
    score: 37,
    risk: "Low",
    decision: "Cleared",
    method: "UPI · •••• 3371",
    device: "Android · App",
    anomaly: "No signal",
    model: "Logistic Regression",
    factors: [
      { label: "Trusted device", value: "Seen 52 times", weight: 8, tone: "lime" },
      { label: "Usual merchant", value: "Regular purchase", weight: 5, tone: "lime" },
      { label: "Normal velocity", value: "Within baseline", weight: 3, tone: "lime" },
    ],
  },
  {
    id: "TX-9771H",
    time: "Today · 08:57:31",
    merchant: "PixelHouse Studio",
    category: "Services",
    location: "Delhi, IN",
    amount: 24200,
    score: 76,
    risk: "High",
    decision: "Review",
    method: "Card · •••• 9012",
    device: "Firefox · Linux",
    anomaly: "New merchant",
    model: "Random Forest",
    factors: [
      { label: "New merchant", value: "No prior relationship", weight: 72, tone: "danger" },
      { label: "Device mismatch", value: "Device seen in 4 accounts", weight: 63, tone: "amber" },
      { label: "Amount deviation", value: "4.1× personal average", weight: 49, tone: "lime" },
    ],
  },
];

const trendData = [
  { day: "01 Aug", flagged: 18, reviewed: 11 },
  { day: "02 Aug", flagged: 24, reviewed: 15 },
  { day: "03 Aug", flagged: 21, reviewed: 17 },
  { day: "04 Aug", flagged: 31, reviewed: 20 },
  { day: "05 Aug", flagged: 26, reviewed: 22 },
  { day: "06 Aug", flagged: 39, reviewed: 25 },
  { day: "07 Aug", flagged: 34, reviewed: 28 },
  { day: "08 Aug", flagged: 47, reviewed: 31 },
  { day: "09 Aug", flagged: 42, reviewed: 35 },
  { day: "10 Aug", flagged: 56, reviewed: 39 },
  { day: "11 Aug", flagged: 48, reviewed: 42 },
  { day: "12 Aug", flagged: 61, reviewed: 46 },
];

const categoryData = [
  { name: "Card testing", value: 38, color: "#f97361" },
  { name: "Account takeover", value: 27, color: "#f2b45c" },
  { name: "Geo anomaly", value: 19, color: "#b9df72" },
  { name: "Velocity", value: 16, color: "#6c8990" },
];

const modelRows = [
  { name: "XGBoost v2.4", type: "Supervised", precision: "91.8%", recall: "88.4%", auc: "0.982", status: "Champion" },
  { name: "Random Forest", type: "Supervised", precision: "87.3%", recall: "84.9%", auc: "0.961", status: "Stable" },
  { name: "Isolation Forest", type: "Unsupervised", precision: "64.1%", recall: "71.2%", auc: "0.894", status: "Shadow" },
  { name: "Logistic Regression", type: "Baseline", precision: "78.6%", recall: "76.8%", auc: "0.932", status: "Baseline" },
];

const navItems: { label: View; icon: typeof LayoutDashboard; badge?: string }[] = [
  { label: "Overview", icon: LayoutDashboard },
  { label: "Transactions", icon: Layers3, badge: "24" },
  { label: "Alerts", icon: Bell, badge: "7" },
  { label: "Models", icon: Cpu },
];

const money = (value: number): string => `₹${value.toLocaleString("en-IN")}`;

function RiskBadge({ risk }: { risk: RiskLevel }) {
  return <span className={`risk-badge risk-${risk.toLowerCase()}`}><span />{risk}</span>;
}

function DecisionBadge({ decision }: { decision: Decision }) {
  return <span className={`decision-badge decision-${decision.toLowerCase().replace(" ", "-")}`}>{decision}</span>;
}

function MetricCard({
  label,
  value,
  detail,
  trend,
  tone,
  icon: Icon,
}: {
  label: string;
  value: string;
  detail: string;
  trend: "up" | "down" | "neutral";
  tone: "lime" | "coral" | "amber" | "blue";
  icon: typeof Activity;
}) {
  return (
    <article className="metric-card">
      <div className={`metric-icon metric-${tone}`}><Icon size={17} strokeWidth={2.1} /></div>
      <div className="metric-label">{label}<CircleHelp size={13} /></div>
      <div className="metric-value">{value}</div>
      <div className={`metric-detail detail-${trend}`}>
        {trend === "up" ? <ArrowUpRight size={14} /> : trend === "down" ? <ArrowDownRight size={14} /> : <Activity size={14} />}
        {detail}
      </div>
    </article>
  );
}

function EmptySearchState() {
  return (
    <div className="empty-state">
      <Search size={22} />
      <strong>No transactions match</strong>
      <span>Try a different search or risk filter.</span>
    </div>
  );
}

function TransactionTable({
  onSelect,
  compact = false,
}: {
  onSelect: (transaction: Transaction) => void;
  compact?: boolean;
}) {
  const [query, setQuery] = useState<string>("");
  const [riskFilter, setRiskFilter] = useState<string>("All risk");
  const [page, setPage] = useState<number>(1);

  const filteredTransactions = useMemo(() => {
    return transactions.filter((transaction) => {
      const matchesQuery = `${transaction.id} ${transaction.merchant} ${transaction.location} ${transaction.category}`
        .toLowerCase()
        .includes(query.toLowerCase());
      const matchesRisk = riskFilter === "All risk" || transaction.risk === riskFilter;
      return matchesQuery && matchesRisk;
    });
  }, [query, riskFilter]);

  const visibleTransactions = compact ? filteredTransactions.slice(0, 5) : filteredTransactions;

  return (
    <section className={`table-card ${compact ? "table-card-compact" : ""}`}>
      <div className="table-heading">
        <div>
          <p className="eyebrow">INVESTIGATION QUEUE</p>
          <h2>{compact ? "Priority review" : "All transactions"}</h2>
        </div>
        <div className="table-heading-actions">
          <button className="icon-button subtle" aria-label="More table actions"><MoreHorizontal size={18} /></button>
          {!compact && <button className="outline-button" onClick={() => toast.success("CSV export prepared", { description: "Your filtered transaction report is ready." })}><Download size={15} /> Export CSV</button>}
        </div>
      </div>
      <div className="table-toolbar">
        <label className="search-field">
          <Search size={15} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search ID, merchant, location..." aria-label="Search transactions" />
        </label>
        <div className="filter-wrap">
          <Filter size={14} />
          <select value={riskFilter} onChange={(event) => setRiskFilter(event.target.value)} aria-label="Filter by risk">
            <option>All risk</option>
            <option>Critical</option>
            <option>High</option>
            <option>Medium</option>
            <option>Low</option>
          </select>
          <ChevronDown size={14} />
        </div>
        <span className="result-count">{filteredTransactions.length} signals</span>
      </div>
      <div className="transaction-table-wrap">
        {visibleTransactions.length === 0 ? <EmptySearchState /> : (
          <table className="transaction-table">
            <thead>
              <tr><th>Transaction</th><th>Merchant</th><th>Amount</th><th>Risk score</th><th>Signal</th><th>Decision</th><th /></tr>
            </thead>
            <tbody>
              {visibleTransactions.map((transaction) => (
                <tr key={transaction.id} onClick={() => onSelect(transaction)}>
                  <td><div className="id-cell"><span className={`signal-dot ${transaction.risk.toLowerCase()}`} /> <div><strong>{transaction.id}</strong><small>{transaction.time}</small></div></div></td>
                  <td><div className="merchant-cell"><strong>{transaction.merchant}</strong><small><MapPin size={11} /> {transaction.location}</small></div></td>
                  <td><strong className="amount-cell">{money(transaction.amount)}</strong></td>
                  <td><div className="score-cell"><div className="score-track"><span style={{ width: `${transaction.score}%` }} className={`score-fill score-${transaction.risk.toLowerCase()}`} /></div><strong>{transaction.score}</strong></div></td>
                  <td><span className="anomaly-cell"><AlertTriangle size={13} /> {transaction.anomaly}</span></td>
                  <td><DecisionBadge decision={transaction.decision} /></td>
                  <td><button className="row-open" aria-label={`Open ${transaction.id}`}><ChevronRight size={16} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {!compact && <div className="table-footer"><span>Showing {visibleTransactions.length} of 1,284 transactions</span><div className="pagination"><button className="icon-button subtle" disabled={page === 1} onClick={() => setPage((current) => Math.max(1, current - 1))} aria-label="Previous page"><ChevronLeft size={15} /></button><span>{page} / 129</span><button className="icon-button subtle" onClick={() => setPage((current) => current + 1)} aria-label="Next page"><ChevronRight size={15} /></button></div></div>}
    </section>
  );
}

function TrendChart() {
  const [range, setRange] = useState<string>("12 days");
  return (
    <section className="panel chart-panel">
      <div className="panel-heading">
        <div><p className="eyebrow">DETECTION ACTIVITY</p><h2>Signals over time</h2></div>
        <div className="panel-heading-right"><div className="legend"><span className="legend-dot lime" /> Flagged <span className="legend-dot blue" /> Reviewed</div><select className="mini-select" value={range} onChange={(event) => setRange(event.target.value)} aria-label="Select chart range"><option>12 days</option><option>30 days</option><option>24 hours</option></select></div>
      </div>
      <div className="chart-summary"><strong>61</strong><span>signals detected today</span><span className="positive-pill"><ArrowDownRight size={13} /> 12.8% vs last period</span></div>
      <div className="trend-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={trendData} margin={{ top: 10, right: 4, left: -18, bottom: 0 }}><defs><linearGradient id="flaggedGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#b9df72" stopOpacity={0.24} /><stop offset="100%" stopColor="#b9df72" stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke="#22323a" strokeDasharray="3 6" vertical={false} /><XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fill: "#6d8389", fontSize: 11 }} dy={8} /><YAxis tickLine={false} axisLine={false} tick={{ fill: "#6d8389", fontSize: 11 }} /><Tooltip contentStyle={{ background: "#132127", border: "1px solid #2d4249", borderRadius: 10, color: "#eff5ec", fontSize: 12 }} /><Area type="monotone" dataKey="flagged" name="Flagged" stroke="#b9df72" strokeWidth={2.5} fill="url(#flaggedGradient)" /><Area type="monotone" dataKey="reviewed" name="Reviewed" stroke="#6d9aa4" strokeWidth={2} fill="transparent" /></AreaChart></ResponsiveContainer></div>
    </section>
  );
}

function DistributionChart() {
  return (
    <section className="panel distribution-panel">
      <div className="panel-heading"><div><p className="eyebrow">SIGNAL MIX</p><h2>Why transactions flag</h2></div><button className="icon-button subtle" aria-label="Signal mix options"><MoreHorizontal size={18} /></button></div>
      <div className="distribution-content">
        <div className="donut-wrap"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={categoryData} dataKey="value" nameKey="name" innerRadius={60} outerRadius={82} paddingAngle={4} stroke="none">{categoryData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}</Pie></PieChart></ResponsiveContainer><div className="donut-center"><strong>1,284</strong><span>flagged</span></div></div>
        <div className="distribution-legend">{categoryData.map((item) => <div className="distribution-row" key={item.name}><span className="legend-color" style={{ background: item.color }} /><span>{item.name}</span><strong>{item.value}%</strong></div>)}</div>
      </div>
      <div className="distribution-foot"><span><span className="trend-up-dot" /> 4 signal types trending</span><button className="text-button">View breakdown <ChevronRight size={14} /></button></div>
    </section>
  );
}

function AlertFeed({ onSelect }: { onSelect: (transaction: Transaction) => void }) {
  return (
    <section className="panel alert-feed-panel">
      <div className="panel-heading"><div><p className="eyebrow">LIVE FEED</p><h2>Needs attention</h2></div><span className="live-indicator"><span /> Live</span></div>
      <div className="alert-feed-list">{transactions.slice(0, 4).map((transaction) => <button className="alert-feed-row" key={transaction.id} onClick={() => onSelect(transaction)}><div className={`feed-icon feed-${transaction.risk.toLowerCase()}`}><AlertTriangle size={15} /></div><div className="feed-copy"><strong>{transaction.merchant}</strong><span>{transaction.anomaly} · {transaction.location}</span></div><div className="feed-score"><strong>{transaction.score}</strong><span>risk</span></div></button>)}</div>
      <button className="feed-footer-button" onClick={() => toast("Showing all active signals")}>Open live queue <ChevronRight size={15} /></button>
    </section>
  );
}

function AlertsView({ onSelect }: { onSelect: (transaction: Transaction) => void }) {
  return (
    <div className="view-stack">
      <div className="view-title-row"><div><p className="eyebrow">RESPONSE CENTER</p><h1>Alerts</h1><p className="view-description">Prioritize the signals that need a human decision before they become losses.</p></div><button className="outline-button" onClick={() => toast.success("Alert rules synced", { description: "Seven active rules are monitoring new activity." })}><RefreshCw size={15} /> Sync rules</button></div>
      <div className="alert-stats"><div><span className="stat-kicker">UNREAD</span><strong>7</strong><small>3 critical, 4 high</small></div><div><span className="stat-kicker">AVG. RESPONSE</span><strong>12m</strong><small><span className="text-lime">↓ 18%</span> this week</small></div><div><span className="stat-kicker">PREVENTED</span><strong>₹4.8L</strong><small>estimated exposure</small></div></div>
      <section className="alert-rules-panel"><div className="panel-heading"><div><p className="eyebrow">ACTIVE SIGNALS</p><h2>Alert queue</h2></div><button className="outline-button" onClick={() => toast("New alert rule builder coming next")}> <Settings2 size={15} /> Manage rules</button></div><div className="alert-list">{transactions.slice(0, 6).map((transaction, index) => <button className="alert-list-row" key={transaction.id} onClick={() => onSelect(transaction)}><div className={`alert-priority priority-${transaction.risk.toLowerCase()}`}><span /></div><div className="alert-main"><div><strong>{transaction.anomaly}</strong><span>{transaction.merchant} · {transaction.id}</span></div><small>{index + 2}m ago</small></div><RiskBadge risk={transaction.risk} /><ChevronRight size={16} className="muted-icon" /></button>)}</div></section>
    </div>
  );
}

function ModelsView() {
  const [threshold, setThreshold] = useState<number>(72);
  return (
    <div className="view-stack">
      <div className="view-title-row"><div><p className="eyebrow">MODEL HEALTH</p><h1>Detection models</h1><p className="view-description">Compare performance, tune review thresholds, and keep explainability in the loop.</p></div><button className="solid-button" onClick={() => toast.success("Retraining queued", { description: "The next training run will include analyst feedback." })}><Sparkles size={15} /> Retrain models</button></div>
      <div className="model-hero"><div className="model-hero-icon"><Gauge size={23} /></div><div><span className="stat-kicker">CURRENT CHAMPION</span><h2>XGBoost v2.4 <span className="champion-pill">Production</span></h2><p>Last evaluated 14 minutes ago on 1.2M transactions · PR-AUC <strong>0.941</strong></p></div><div className="model-hero-metrics"><div><span>Precision</span><strong>91.8%</strong></div><div><span>Recall</span><strong>88.4%</strong></div><div><span>Explainability</span><strong className="text-lime">Ready</strong></div></div></div>
      <section className="panel model-table-panel"><div className="panel-heading"><div><p className="eyebrow">BENCHMARKS</p><h2>Model comparison</h2></div><span className="last-run"><Clock3 size={14} /> Updated today, 10:28</span></div><div className="model-table-wrap"><table className="model-table"><thead><tr><th>Model</th><th>Precision</th><th>Recall</th><th>ROC-AUC</th><th>Role</th></tr></thead><tbody>{modelRows.map((row) => <tr key={row.name}><td><div className="model-name"><span className={`model-dot ${row.status === "Champion" ? "active" : ""}`} /><div><strong>{row.name}</strong><small>{row.type}</small></div></div></td><td>{row.precision}</td><td>{row.recall}</td><td className="mono-text">{row.auc}</td><td><span className={`model-status model-${row.status.toLowerCase()}`}>{row.status}</span></td></tr>)}</tbody></table></div></section>
      <section className="threshold-panel"><div><p className="eyebrow">REVIEW POLICY</p><h2>Risk threshold</h2><p>Transactions above this score enter the analyst queue automatically.</p></div><div className="threshold-control"><div className="threshold-value"><strong>{threshold}</strong><span>/ 100</span><RiskBadge risk="High" /></div><input type="range" min="50" max="95" value={threshold} onChange={(event) => setThreshold(Number(event.target.value))} aria-label="Risk review threshold" /><div className="threshold-scale"><span>More coverage</span><span>Fewer false positives</span></div></div></section>
    </div>
  );
}

function TransactionDrawer({ transaction, onClose, onDecision }: { transaction: Transaction; onClose: () => void; onDecision: (decision: Decision) => void }) {
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="transaction-drawer" onClick={(event) => event.stopPropagation()}>
        <div className="drawer-header"><div><span className="drawer-kicker"><span className="pulse-dot" /> INVESTIGATION</span><h2>{transaction.id}</h2></div><button className="icon-button subtle" onClick={onClose} aria-label="Close transaction details"><X size={18} /></button></div>
        <div className="drawer-body"><div className="drawer-risk-summary"><div><span className="stat-kicker">RISK SCORE</span><strong className={`large-score score-text-${transaction.risk.toLowerCase()}`}>{transaction.score}</strong><span>out of 100</span></div><RiskBadge risk={transaction.risk} /></div>
          <div className="drawer-merchant"><div className="merchant-avatar">{transaction.merchant.slice(0, 1)}</div><div><strong>{transaction.merchant}</strong><span>{transaction.category} · {transaction.location}</span></div><button className="icon-button subtle" aria-label="More transaction options"><MoreHorizontal size={17} /></button></div>
          <div className="detail-grid"><div><span>Amount</span><strong>{money(transaction.amount)}</strong></div><div><span>Payment</span><strong>{transaction.method}</strong></div><div><span>Device</span><strong>{transaction.device}</strong></div><div><span>Model</span><strong>{transaction.model}</strong></div></div>
          <div className="explain-section"><div className="explain-heading"><div><p className="eyebrow">EXPLAINABILITY</p><h3>Why this was flagged</h3></div><span className="shap-pill">SHAP</span></div><p className="explain-caption">Top contributing signals from the model prediction, ordered by impact.</p><div className="factor-list">{transaction.factors.map((factor) => <div className="factor-row" key={factor.label}><div className="factor-meta"><span>{factor.label}</span><strong>{factor.value}</strong></div><div className="factor-track"><span className={`factor-fill factor-${factor.tone}`} style={{ width: `${factor.weight}%` }} /></div><span className="factor-weight">+{factor.weight}</span></div>)}</div></div>
          <div className="drawer-note"><FileWarning size={16} /><div><strong>Recommended action</strong><span>Hold payment and request step-up verification.</span></div></div>
        </div>
        <div className="drawer-actions"><button className="dismiss-button" onClick={() => onDecision("False positive")}><X size={15} /> False positive</button><button className="confirm-button" onClick={() => onDecision("Confirmed fraud")}><Check size={15} /> Confirm fraud</button></div>
      </aside>
    </div>
  );
}

function Overview({ onSelect }: { onSelect: (transaction: Transaction) => void }) {
  const [currentTime, setCurrentTime] = useState(() => new Date());

  useEffect(() => {
    let intervalId: number;
    const timeoutId = window.setTimeout(() => {
      setCurrentTime(new Date());
      intervalId = window.setInterval(() => setCurrentTime(new Date()), 60_000);
    }, 60_000 - (Date.now() % 60_000));

    return () => {
      window.clearTimeout(timeoutId);
      if (intervalId) window.clearInterval(intervalId);
    };
  }, []);

  return (
    <>
      <section className="welcome-row"><div><p className="eyebrow">WEDNESDAY, 12 AUGUST 2026</p><h1>{getGreeting(currentTime)}, {loggedInUser.name.split(" ")[0]}.</h1><p className="welcome-subtitle">Here is the latest read on your financial protection layer.</p></div><div className="welcome-actions"><button className="outline-button" onClick={() => toast.success("Report exported", { description: "A CSV snapshot of today’s signals was downloaded." })}><Download size={15} /> Export report</button><button className="solid-button" onClick={() => toast("Ingestion simulator started", { description: "New transactions will appear in the live feed." })}><Upload size={15} /> Ingest data</button></div></section>
      <div className="protection-strip"><div className="protection-icon"><ShieldCheck size={19} /></div><div><strong>Protection layer is active</strong><span>Scoring 1,284 transactions in the last 24 hours with 99.98% pipeline uptime.</span></div><div className="protection-meta"><Radio size={14} /> Last event 18 sec ago</div></div>
      <section className="metric-grid"><MetricCard label="Total transactions" value="1.28M" detail="8.6% vs last period" trend="up" tone="blue" icon={Layers3} /><MetricCard label="Flagged for review" value="1,284" detail="12.8% vs last period" trend="down" tone="lime" icon={ShieldAlert} /><MetricCard label="Confirmed fraud" value="₹18.6L" detail="₹2.1L prevented today" trend="up" tone="coral" icon={AlertTriangle} /><MetricCard label="False positive rate" value="3.2%" detail="0.7% improvement" trend="down" tone="amber" icon={Gauge} /></section>
      <div className="overview-grid"><TrendChart /><DistributionChart /><AlertFeed onSelect={onSelect} /></div>
      <TransactionTable onSelect={onSelect} compact />
    </>
  );
}

const Index = () => {
  const [activeView, setActiveView] = useState<View>("Overview");
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [handledDecisions, setHandledDecisions] = useState<Record<string, Decision>>({});

  const openTransaction = (transaction: Transaction): void => setSelectedTransaction(transaction);
  const handleDecision = (decision: Decision): void => {
    if (!selectedTransaction) return;
    setHandledDecisions((current) => ({ ...current, [selectedTransaction.id]: decision }));
    toast.success(decision === "Confirmed fraud" ? "Fraud confirmed" : "Signal dismissed", { description: `${selectedTransaction.id} has been added to the feedback loop.` });
    setSelectedTransaction(null);
  };

  const visibleTransactions = transactions.map((transaction) => ({ ...transaction, decision: handledDecisions[transaction.id] ?? transaction.decision }));

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><ShieldCheck size={21} /></div><div><strong>SENTINEL</strong><span>Fraud operations</span></div></div>
        <div className="sidebar-status"><span className="status-pulse" /> System nominal <span>v2.4</span></div>
        <div className="nav-section"><span className="nav-label">Workspace</span>{navItems.map((item) => <button key={item.label} className={`nav-item ${activeView === item.label ? "active" : ""}`} onClick={() => setActiveView(item.label)}><item.icon size={17} strokeWidth={activeView === item.label ? 2.4 : 1.9} /><span>{item.label}</span>{item.badge && <em>{item.label === "Transactions" ? "1,284" : item.badge}</em>}</button>)}</div>
        <div className="nav-section secondary-nav"><span className="nav-label">Configure</span><button className="nav-item" onClick={() => toast("Data sources are healthy") }><Radio size={17} /><span>Data sources</span><span className="nav-live-dot" /></button><button className="nav-item" onClick={() => setActiveView("Models")}><SlidersHorizontal size={17} /><span>Thresholds</span></button><button className="nav-item" onClick={() => toast("Audit log opened") }><ListFilter size={17} /><span>Audit log</span></button></div>
        <div className="sidebar-bottom"><div className="help-card"><div className="help-icon"><CircleHelp size={16} /></div><div><strong>Need a hand?</strong><span>Read the analyst guide</span></div><ChevronRight size={15} /></div><div className="user-card"><div className="avatar">{loggedInUser.initials}</div><div><strong>{loggedInUser.name}</strong><span>{loggedInUser.role}</span></div><MoreHorizontal size={16} /></div></div>
      </aside>
      <main className="main-content">
        <header className="topbar"><div className="breadcrumb"><span>Workspace</span><ChevronRight size={14} /><strong>{activeView}</strong></div><div className="topbar-actions"><div className="live-chip"><span /> LIVE MONITORING</div><button className="icon-button" aria-label="Open notifications" onClick={() => setActiveView("Alerts")}><Bell size={18} /><span className="notification-dot">7</span></button><button className="avatar top-avatar" aria-label="Open profile">AS</button></div></header>
        <div className="content-wrap">
          {activeView === "Overview" && <Overview onSelect={openTransaction} />}
          {activeView === "Transactions" && <div className="view-stack"><div className="view-title-row"><div><p className="eyebrow">TRANSACTION MONITOR</p><h1>All transactions</h1><p className="view-description">Search, filter, and investigate every scored event across the network.</p></div><button className="outline-button" onClick={() => toast.success("CSV export prepared")}><Download size={15} /> Export report</button></div><div className="transactions-toolbar-note"><div className="note-icon"><Sparkles size={15} /></div><span><strong>Smart queue is on.</strong> High-risk transactions are sorted first using model confidence and potential exposure.</span><button className="text-button">Tune queue <ChevronRight size={14} /></button></div><TransactionTable onSelect={openTransaction} /></div>}
          {activeView === "Alerts" && <AlertsView onSelect={openTransaction} />}
          {activeView === "Models" && <ModelsView />}
        </div>
      </main>
      {selectedTransaction && <TransactionDrawer transaction={{ ...selectedTransaction, decision: handledDecisions[selectedTransaction.id] ?? selectedTransaction.decision }} onClose={() => setSelectedTransaction(null)} onDecision={handleDecision} />}
      <div className="hidden-data" aria-hidden="true">{visibleTransactions.length}</div>
    </div>
  );
};

export default Index;
