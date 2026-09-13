import { useState } from "react";
import "./App.css";

type Analysis = {
  product: {
    name: string;
    category: string;
    price: string;
    description: string;
  };
  seller: {
    name: string;
    location: string;
    trustNotes: string;
  };
  productDetails: {
    manufacturingLocation: string;
    sellingLocation: string;
    warranty: string;
    returnPolicy: string;
  };
  claims: {
    claim: string;
    status: string;
    explanation: string;
  }[];
  evidence: {
    source: string;
    finding: string;
    reliability: string;
  }[];
  contradictions: string[];
  riskFactors: string[];
  riskScore: number;
  confidenceScore: number;
  decision: "BUY" | "VERIFY FIRST" | "AVOID";
  decisionSummary: string;
  bestBuyingAdvice: string;
  sellerLocationVerification?: {
    status: "VERIFIED" | "PARTIAL MATCH" | "NOT FOUND" | "NOT VERIFIED" | "UNABLE TO VERIFY" | string;
    verificationScore: number;
    sellerNameProvided: string;
    locationProvided: string;
    matchedPlaceName: string;
    matchedAddress: string;
    businessStatus: string;
    googleMapsUrl: string;
    nameMatchScore: number;
    locationMatchScore: number;
    message: string;
  };
};

type HistoryItem = {
  id: string; timestamp: string; url: string; productName: string;
  sellerName: string; price: string; riskScore: number; confidenceScore: number;
  decision: Analysis["decision"]; analysis: Analysis;
};

function App() {
  const [url, setUrl] = useState("");
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>(() => {
    try { return JSON.parse(localStorage.getItem("bharatBuyerShieldHistory") || "[]"); }
    catch { return []; }
  });
  const [showHistory, setShowHistory] = useState(false);

  const saveToHistory = (result: Analysis, sourceUrl: string) => {
    const item: HistoryItem = {
      id: Date.now().toString(), timestamp: new Date().toISOString(), url: sourceUrl,
      productName: result.product?.name || "Unknown Product",
      sellerName: result.seller?.name || "Unknown Seller",
      price: result.product?.price || "Not available",
      riskScore: result.riskScore ?? 0, confidenceScore: result.confidenceScore ?? 0,
      decision: result.decision, analysis: result,
    };
    setHistory(prev => {
      const next = [item, ...prev].slice(0, 50);
      localStorage.setItem("bharatBuyerShieldHistory", JSON.stringify(next));
      return next;
    });
  };

  const openHistoryItem = (item: HistoryItem) => { setAnalysis(item.analysis); setShowHistory(false); setError(""); };
  const clearHistory = () => { localStorage.removeItem("bharatBuyerShieldHistory"); setHistory([]); };
  const formatHistoryTime = (ts: string) => new Date(ts).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

  const handleAnalyze = async () => {
    if (!url.trim() && !screenshot) {
      setError("Paste a product URL or upload a product screenshot.");
      return;
    }

    setLoading(true);
    setError("");
    setAnalysis(null);

    try {
      const formData = new FormData();

      if (url.trim()) {
        formData.append("url", url.trim());
      }

      if (screenshot) {
        formData.append("screenshot", screenshot);
      }

      const response = await fetch("http://localhost:5000/api/analyze", {
        method: "POST",
        body: formData,
      });

      let data: any = null;

      try {
        data = await response.json();
      } catch {
        throw new Error(
          "Backend returned an invalid response. Make sure the API is running on http://localhost:5000."
        );
      }

      if (!response.ok) {
        throw new Error(
          data?.error ||
            data?.details ||
            `Analysis failed (HTTP ${response.status})`
        );
      }

      if (!data?.analysis) {
        throw new Error("Backend returned no analysis.");
      }

      setAnalysis(data.analysis);
      saveToHistory(data.analysis, url.trim());
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unable to analyze this product.";

      if (
        message.toLowerCase().includes("failed to fetch") ||
        message.toLowerCase().includes("networkerror")
      ) {
        setError(
          "Backend is not reachable. Start the API with `npm run dev` and make sure it is running on http://localhost:5000."
        );
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  };

  const getDecisionClass = () => {
    if (!analysis) return "";

    if (analysis.decision === "BUY") return "buy";
    if (analysis.decision === "AVOID") return "avoid";

    return "verify";
  };

  const getDecisionIcon = () => {
    if (!analysis) return "🟡";

    if (analysis.decision === "BUY") return "🟢";
    if (analysis.decision === "AVOID") return "🔴";

    return "🟡";
  };

  const getLocationVerificationClass = () => {
    const status = analysis?.sellerLocationVerification?.status;

    if (status === "VERIFIED") return "verified";
    if (status === "PARTIAL MATCH") return "partial";
    if (status === "NOT FOUND" || status === "NOT VERIFIED") return "not-verified";

    return "unable";
  };

  const getLocationVerificationIcon = () => {
    const status = analysis?.sellerLocationVerification?.status;

    if (status === "VERIFIED") return "✅";
    if (status === "PARTIAL MATCH") return "🟡";
    if (status === "NOT FOUND" || status === "NOT VERIFIED") return "❌";

    return "⚪";
  };

  return (
    <div className="app">
      {showHistory && (
        <div onClick={() => setShowHistory(false)} style={{position:"fixed",inset:0,zIndex:1000,background:"rgba(0,0,0,.68)",display:"flex",justifyContent:"flex-end"}}>
          <aside onClick={e => e.stopPropagation()} style={{width:"min(440px,92vw)",height:"100%",overflowY:"auto",background:"#111827",padding:"24px",boxSizing:"border-box",boxShadow:"-12px 0 40px rgba(0,0,0,.35)"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div><span className="section-label">LOCAL STORAGE</span><h2 style={{margin:"6px 0"}}>Search History</h2></div>
              <button type="button" onClick={() => setShowHistory(false)} style={{border:0,background:"rgba(255,255,255,.08)",color:"#fff",borderRadius:10,width:38,height:38,cursor:"pointer"}}>✕</button>
            </div>
            <p style={{opacity:.65,fontSize:13}}>Saved only in this browser on this device.</p>
            {!history.length ? <div style={{padding:"28px 18px",textAlign:"center",borderRadius:16,background:"rgba(255,255,255,.035)",marginTop:28}}><div style={{fontSize:34}}>🕘</div><h3>No history yet</h3><p style={{opacity:.6}}>Completed analyses will appear here.</p></div> : <>
              <div style={{display:"flex",justifyContent:"flex-end",margin:"18px 0 12px"}}><button type="button" onClick={clearHistory} style={{border:"1px solid rgba(248,113,113,.35)",background:"rgba(248,113,113,.08)",color:"#fca5a5",padding:"8px 12px",borderRadius:9,cursor:"pointer"}}>Clear History</button></div>
              <div style={{display:"grid",gap:12}}>{history.map(item => <button type="button" key={item.id} onClick={() => openHistoryItem(item)} style={{textAlign:"left",width:"100%",padding:16,borderRadius:14,border:"1px solid rgba(255,255,255,.08)",background:"rgba(255,255,255,.035)",color:"#fff",cursor:"pointer"}}>
                <div style={{display:"flex",justifyContent:"space-between",gap:12}}><strong>{item.productName}</strong><span style={{fontSize:11,fontWeight:800}}>{item.decision}</span></div>
                <div style={{marginTop:9,fontSize:13,opacity:.7,lineHeight:1.5}}>Seller: {item.sellerName}<br/>Risk: {item.riskScore}/100 · Confidence: {item.confidenceScore}%<br/>{formatHistoryTime(item.timestamp)}</div>
              </button>)}</div>
            </>}
          </aside>
        </div>
      )}
      {/* NAVBAR */}
      <nav className="navbar">
        <div className="brand">
          <div className="brand-icon">🛡️</div>

          <div>
            <h2>Bharat Buyer Shield</h2>
            <span>AI-powered buyer protection</span>
          </div>
        </div>

        <button type="button" onClick={() => setShowHistory(true)} style={{marginLeft:"auto",marginRight:"14px",padding:"10px 16px",borderRadius:"12px",border:"1px solid rgba(167,139,250,.45)",background:"rgba(99,102,241,.08)",color:"#fff",cursor:"pointer",fontWeight:700}}>
          🕘 History {history.length ? `(${history.length})` : ""}
        </button>

        <div className="nav-status">
          <span className="status-dot"></span>
          AI Protection Active
        </div>
      </nav>

      {/* HERO / INPUT */}
      {!analysis && (
        <main>
          <section className="hero">
            <div className="badge">
              ✦ AI-POWERED PRODUCT VERIFICATION
            </div>

            <h1>
              Shop smarter.
              <br />
              <span>Buy with confidence.</span>
            </h1>

            <p className="hero-text">
              Paste any product URL or upload a screenshot and let Bharat Buyer Shield analyze the
              product, seller, price, claims, reviews, policies and available
              evidence before you spend your money.
            </p>

            <div className="url-box">
              <div className="url-icon">🔗</div>

              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="Paste product URL here..."
                disabled={loading}
              />

              <button onClick={handleAnalyze} disabled={loading}>
                {loading ? "Analyzing..." : "Analyze Product"}
                <span>{loading ? "◌" : "→"}</span>
              </button>
            </div>

            {/* PRODUCT SCREENSHOT UPLOAD */}
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                gap: "12px",
                marginTop: "14px",
                marginBottom: "8px",
                flexWrap: "wrap",
              }}
            >
              <label
                htmlFor="product-screenshot"
                style={{
                  cursor: loading ? "not-allowed" : "pointer",
                  padding: "12px 20px",
                  border: "1px solid rgba(139, 92, 246, 0.65)",
                  borderRadius: "12px",
                  color: "#fff",
                  background: "rgba(99, 102, 241, 0.08)",
                  fontWeight: 600,
                  opacity: loading ? 0.5 : 1,
                }}
              >
                📷 Upload Product Screenshot
              </label>

              <input
                id="product-screenshot"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={loading}
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;

                  if (!file) {
                    setScreenshot(null);
                    return;
                  }

                  if (file.size > 10 * 1024 * 1024) {
                    setScreenshot(null);
                    setError("Screenshot must be smaller than 10 MB.");
                    return;
                  }

                  setScreenshot(file);
                  setError("");
                  console.log("📷 Screenshot selected:", file.name);
                }}
              />

              {screenshot && (
                <span
                  style={{
                    color: "#a78bfa",
                    fontSize: "14px",
                    maxWidth: "360px",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  ✓ {screenshot.name}
                </span>
              )}
            </div>

            <p
              style={{
                textAlign: "center",
                fontSize: "13px",
                opacity: 0.6,
                marginBottom: "18px",
              }}
            >
              Use a screenshot when the shopping website restricts direct product-page access.
            </p>

            {error && <div className="error-box">⚠️ {error}</div>}

            <p className="privacy-note">
              🔒 AI-powered analysis designed to help you make safer buying
              decisions.
            </p>
          </section>

          <section className="decision-preview">
            <div className="section-heading">
              <span>WHAT WE CHECK</span>
              <h2>From product listing to buying decision.</h2>
            </div>

            <div className="cards">
              <div className="info-card">
                <div className="card-icon blue">🔍</div>
                <h3>Product Intelligence</h3>
                <p>
                  Product type, specifications, price, seller, location,
                  warranty and important claims.
                </p>
              </div>

              <div className="info-card">
                <div className="card-icon purple">🧠</div>
                <h3>AI Risk Analysis</h3>
                <p>
                  Detect suspicious claims, unusual pricing, contradictions,
                  review signals and missing evidence.
                </p>
              </div>

              <div className="info-card">
                <div className="card-icon green">✓</div>
                <h3>Clear Decision</h3>
                <p>
                  Get a simple BUY, VERIFY FIRST or AVOID recommendation with
                  reasons and confidence.
                </p>
              </div>

              <div className="info-card">
                <div className="card-icon orange">₹</div>
                <h3>Better Buying Option</h3>
                <p>
                  Find a better available price and trusted purchase source
                  whenever possible.
                </p>
              </div>
            </div>
          </section>
        </main>
      )}

      {/* RESULT DASHBOARD */}
      {analysis && (
        <main className="results-page">
          <div className="results-header">
            <div>
              <span className="section-label">AI PRODUCT ANALYSIS</span>
              <h1>Buyer Safety Report</h1>
              <p>
                Evidence-based assessment generated from the submitted
                product listing.
              </p>
            </div>

            <button
              className="new-analysis"
              onClick={() => {
                setAnalysis(null);
                setError("");
              }}
            >
              ← Analyze another product
            </button>
          </div>

          {/* DECISION */}
          <section className={`decision-banner ${getDecisionClass()}`}>
            <div className="decision-main">
              <div className="decision-icon">
                {getDecisionIcon()}
              </div>

              <div>
                <span>BUYING DECISION</span>
                <h2>{analysis.decision}</h2>
                <p>{analysis.decisionSummary}</p>
              </div>
            </div>

            <div className="scores">
              <div className="score">
                <span>RISK SCORE</span>
                <strong>{analysis.riskScore}/100</strong>
              </div>

              <div className="score">
                <span>CONFIDENCE</span>
                <strong>{analysis.confidenceScore}%</strong>
              </div>
            </div>
          </section>

          {/* PRODUCT + SELLER */}
          <section className="result-grid">
            <div className="result-card">
              <div className="card-title">
                <span>📦</span>
                <h3>Product Information</h3>
              </div>

              <div className="data-list">
                <div>
                  <span>Product</span>
                  <strong>{analysis.product.name}</strong>
                </div>

                <div>
                  <span>Category</span>
                  <strong>{analysis.product.category}</strong>
                </div>

                <div>
                  <span>Price</span>
                  <strong>{analysis.product.price}</strong>
                </div>

                <div>
                  <span>Description</span>
                  <strong>{analysis.product.description}</strong>
                </div>
              </div>
            </div>

            <div className="result-card">
              <div className="card-title">
                <span>🏪</span>
                <h3>Seller Information</h3>
              </div>

              <div className="data-list">
                <div>
                  <span>Seller</span>
                  <strong>{analysis.seller.name}</strong>
                </div>

                <div>
                  <span>Location</span>
                  <strong>{analysis.seller.location}</strong>
                </div>

                <div>
                  <span>Trust Notes</span>
                  <strong>{analysis.seller.trustNotes}</strong>
                </div>
              </div>
            </div>
          </section>

          {/* SELLER LOCATION VERIFICATION */}
          {analysis.sellerLocationVerification && (
            <section className="wide-card" style={{ marginTop: "24px" }}>
              <div className="card-title">
                <span>🗺️</span>
                <h3>Seller Location Verification</h3>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1.4fr) minmax(220px, 0.6fr)",
                  gap: "24px",
                  alignItems: "stretch",
                }}
              >
                <div>
                  <div
                    className={`location-verification-status ${getLocationVerificationClass()}`}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "10px",
                      padding: "10px 16px",
                      borderRadius: "999px",
                      marginBottom: "18px",
                      fontWeight: 700,
                    }}
                  >
                    <span>{getLocationVerificationIcon()}</span>
                    <span>{analysis.sellerLocationVerification.status}</span>
                  </div>

                  <p
                    style={{
                      margin: "0 0 20px",
                      lineHeight: 1.7,
                      opacity: 0.85,
                    }}
                  >
                    {analysis.sellerLocationVerification.message}
                  </p>

                  <div className="data-list">
                    <div>
                      <span>Seller</span>
                      <strong>
                        {analysis.sellerLocationVerification.sellerNameProvided}
                      </strong>
                    </div>

                    <div>
                      <span>Provided Location</span>
                      <strong>
                        {analysis.sellerLocationVerification.locationProvided}
                      </strong>
                    </div>

                    <div>
                      <span>Google Places Match</span>
                      <strong>
                        {analysis.sellerLocationVerification.matchedPlaceName}
                      </strong>
                    </div>

                    <div>
                      <span>Matched Address</span>
                      <strong>
                        {analysis.sellerLocationVerification.matchedAddress}
                      </strong>
                    </div>

                    <div>
                      <span>Business Status</span>
                      <strong>
                        {analysis.sellerLocationVerification.businessStatus}
                      </strong>
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    alignItems: "center",
                    gap: "16px",
                    padding: "24px",
                    borderRadius: "18px",
                    background: "rgba(255,255,255,0.035)",
                    border: "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  <span
                    style={{
                      fontSize: "12px",
                      letterSpacing: "1.5px",
                      fontWeight: 700,
                      opacity: 0.65,
                    }}
                  >
                    MATCH SCORE
                  </span>

                  <strong style={{ fontSize: "42px", lineHeight: 1 }}>
                    {analysis.sellerLocationVerification.verificationScore}/100
                  </strong>

                  <div
                    style={{
                      width: "100%",
                      display: "grid",
                      gap: "10px",
                      fontSize: "13px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: "12px",
                      }}
                    >
                      <span>Name match</span>
                      <strong>
                        {analysis.sellerLocationVerification.nameMatchScore}/100
                      </strong>
                    </div>

                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: "12px",
                      }}
                    >
                      <span>Location match</span>
                      <strong>
                        {analysis.sellerLocationVerification.locationMatchScore}/100
                      </strong>
                    </div>
                  </div>

                  {analysis.sellerLocationVerification.googleMapsUrl !==
                    "Not available" && (
                    <a
                      href={analysis.sellerLocationVerification.googleMapsUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        width: "100%",
                        textAlign: "center",
                        textDecoration: "none",
                        padding: "12px 16px",
                        borderRadius: "12px",
                        fontWeight: 700,
                        background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                        color: "#fff",
                        boxSizing: "border-box",
                      }}
                    >
                      View on Google Maps →
                    </a>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* LOCATIONS + POLICIES */}
          <section className="result-grid">
            <div className="result-card">
              <div className="card-title">
                <span>📍</span>
                <h3>Location & Protection</h3>
              </div>

              <div className="data-list">
                <div>
                  <span>Manufacturing Location</span>
                  <strong>
                    {analysis.productDetails.manufacturingLocation}
                  </strong>
                </div>

                <div>
                  <span>Selling / Shop Location</span>
                  <strong>{analysis.productDetails.sellingLocation}</strong>
                </div>

                <div>
                  <span>Warranty</span>
                  <strong>{analysis.productDetails.warranty}</strong>
                </div>

                <div>
                  <span>Return Policy</span>
                  <strong>{analysis.productDetails.returnPolicy}</strong>
                </div>
              </div>
            </div>

            <div className="result-card">
              <div className="card-title">
                <span>⚠️</span>
                <h3>Risk Factors</h3>
              </div>

              {analysis.riskFactors.length > 0 ? (
                <ul className="risk-list">
                  {analysis.riskFactors.map((risk, index) => (
                    <li key={index}>{risk}</li>
                  ))}
                </ul>
              ) : (
                <div className="empty-state">
                  No major risk factors identified.
                </div>
              )}
            </div>
          </section>

          {/* CLAIMS */}
          <section className="wide-card">
            <div className="card-title">
              <span>📋</span>
              <h3>Claim Analysis</h3>
            </div>

            <div className="claims">
              {analysis.claims.length > 0 ? (
                analysis.claims.map((item, index) => (
                  <div className="claim" key={index}>
                    <div>
                      <strong>{item.claim}</strong>
                      <p>{item.explanation}</p>
                    </div>

                    <span className="claim-status">
                      {item.status}
                    </span>
                  </div>
                ))
              ) : (
                <div className="empty-state">
                  No specific claims were detected.
                </div>
              )}
            </div>
          </section>

          {/* CONTRADICTIONS */}
          <section className="wide-card">
            <div className="card-title">
              <span>🔎</span>
              <h3>Contradiction Engine</h3>
            </div>

            {analysis.contradictions.length > 0 ? (
              <div className="contradictions">
                {analysis.contradictions.map((item, index) => (
                  <div className="contradiction" key={index}>
                    <span>!</span>
                    <p>{item}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="success-state">
                ✓ No major contradictions detected.
              </div>
            )}
          </section>

          {/* EVIDENCE */}
          <section className="wide-card">
            <div className="card-title">
              <span>🛡️</span>
              <h3>Evidence Locker</h3>
            </div>

            <p className="locker-description">
              Keep this evidence before purchase. These findings explain how
              the buyer decision was reached.
            </p>

            <div className="evidence-grid">
              {analysis.evidence.map((item, index) => (
                <div className="evidence-item" key={index}>
                  <div className="evidence-number">
                    {index + 1}
                  </div>

                  <div>
                    <strong>{item.source}</strong>
                    <p>{item.finding}</p>
                    <span>{item.reliability}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* BEST BUYING ADVICE */}
          <section className="best-buy">
            <div>
              <span className="section-label">SMART BUYING INSIGHT</span>
              <h2>💰 Better Buying Option</h2>
              <p>{analysis.bestBuyingAdvice}</p>
            </div>

            <div className="best-buy-badge">
              AI BUYING
              <br />
              ASSIST
            </div>
          </section>

          {/* FOOTER */}
          <footer>
            <span>© 2026 Bharat Buyer Shield</span>
            <span>AI-assisted buyer protection</span>
          </footer>
        </main>
      )}

      {!analysis && (
        <footer>
          <span>© 2026 Bharat Buyer Shield</span>
          <span>Built for safer online shopping</span>
        </footer>
      )}
    </div>
  );
}

export default App;