# FocusLens: System Architecture & Analytics Flow

FocusLens is an advanced attention-drift monitoring system designed to quantify and predict user focus levels during web browsing. This document outlines the end-to-end data flow and the mathematical models driving the analytics.

---

## 1. End-to-End Data Flow

### Phase A: Data Collection (Content Script)
The journey begins in the browser. The `content.js` script is injected into every tab and monitors behavioral signals in real-time:
- **Tab Visibility**: Tracking `visibilitychange` events to detect context switching.
- **Mouse Dynamics**: Sampling mouse positions to detect idle periods and suspicious (bot-like) patterns.
- **Scroll Velocity**: Measuring scroll speed to identify "rapid scrolling" (a common sign of distraction).
- **Interaction Events**: Counting clicks, copy/paste actions, and keyboard interactions.

### Phase B: Transmission (Background Script)
Every 30 seconds, the content script packages these signals into a **Snapshot** and sends it via Chrome Messaging to `background.js`. The background script then forwards this data to the local Express server via a `POST /api/snapshots` request.

### Phase C: Persistence (Local MongoDB)
The local server (`server.js`) receives the snapshot and stores it in the `Snapshots` collection in MongoDB. Each snapshot is tagged with the site's `hostname` and a timestamp. A 30-day Time-To-Live (TTL) index ensures the database remains lean.

### Phase D: Analytics Pipeline (Processor)
The `analytics/processor.js` runs as a batch or background job. It:
1. Reads raw snapshots from the database.
2. Group snapshots by `hostname` to maintain context.
3. Applies **Advanced Analytics Algorithms** (see below) to calculate refined scores and forecasts.
4. Stores the results in the `Analytics` collection, optimized for dashboard rendering.

### Phase E: Visualization (Dashboard)
The `dashboard.html` fetches both historical data and real-time predictions from the server. It uses `Chart.js` to visualize:
- **Drift Over Time**: A historical line graph of focus levels.
- **Trend Forecast**: A projected 5-minute trajectory of future drift.
- **Site Distribution**: A breakdown of which sites cause the most distraction.

---

## 2. Advanced Algorithms Explained

To ensure high accuracy and actionable insights, FocusLens employs two core mathematical models:

### Algorithm 1: Weighted Sigmoid Drift Score
**The Need**: Simple linear arithmetic (e.g., `Score = signals * weight`) often leads to "jumpy" scores that don't reflect the nuance of human focus.
**The Pro**: We use a **Sigmoid Mapping Function** ($Score = \frac{100}{1 + e^{-k(S - S_0)}}$).
- **Pros**:
  - **Saturation Control**: Focus doesn't drop to zero instantly; the sigmoid curve mimics the natural "drift" process where focus slowly starts to slip, then accelerates, and eventually plateaus.
  - **Stability**: It filters out minor noise while emphasizing sustained idle or distracted behavior.

### Algorithm 2: Holt's Linear Trend (Double Exponential Smoothing)
**The Need**: Simple linear regression captures a global average trend but fails to react to recent changes in behavior (e.g., a user suddenly focusing after a long distracted session).
**The Pro**: This model tracks both the **Level** (current state) and the **Trend** (rate of change) independently.
- **Pros**:
  - **Recency Weighted**: Recent behavior has a higher impact on the forecast than older data, making the 5-minute prediction highly "reactive."
  - **Forecast Trajectory**: It provides a multi-point path (10-step horizon), showing not just *where* the user is going, but *how fast* they are drifting.
  - **Confidence Metrics**: It allows us to calculate how reliable the prediction is based on the consistency of the time-series data.

---

## 3. Dashboard Implementation Details

The dashboard is the final realization of the data pipeline. It is built as a highly responsive Vanilla JS application:
- **Real-time Refresh**: The dashboard polls the server every 10 seconds to update the site list and the currently selected analytics.
- **Dynamic Context**: Clicking a site in the sidebar filters all charts to show data specific to that hostname.
- **Forecast Visualization**:
  - The **Drift Forecast Card** shows the immediate prediction.
  - The **Trend Forecast Line** uses a dashed stroke to clearly distinguish future projections from historical facts.
  - **Color-coded Badges**: Use an HSL-derived color mapping (Green → Yellow → Orange → Red) to provide an instant visual cue of drift severity.

---

## 4. Operational Workflow

To maintain the system, the following flow is typically observed:
1. **Browse**: Move between tabs and interact with sites.
2. **Collect**: Snapshots are automatically saved to MongoDB.
3. **Analyze**: Run `node analytics/processor.js` to process new snapshots into actionable metrics.
4. **Monitor**: Open `dashboard.html` to view the live and predicted focus levels.

---

## 5. Benefits of this Architecture
- **Privacy First**: All data collection and processing happen locally on the user's machine.
- **Performance**: Heavy mathematical processing is offloaded to the `processor.js` job, keeping the browser extension and dashboard UI fast and responsive.
- **Accuracy**: By combining real-time signal tracking with time-series forecasting, FocusLens provides a proactive rather than reactive look at digital productivity.

