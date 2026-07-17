
"use strict";

const $ = (id) => document.getElementById(id);
const money = (n) =>
  Number.isFinite(n)
    ? n.toLocaleString("en-US", { style: "currency", currency: "USD" })
    : "—";
const pct = (n) => (Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : "—");
const signedMoney = (n) =>
  Number.isFinite(n) ? `${n >= 0 ? "+" : ""}${money(n)}` : "—";

let allocationChart = null;
let targetChart = null;
let hysChart = null;
let retirementChart = null;
let historyChart = null;
let historySnapshots = [];

async function loadJson(path) {
  const response = await fetch(`${path}?v=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load ${path}: ${response.status}`);
  return response.json();
}

function monthsToGoal(balance, target, monthly, apy) {
  if (balance >= target) return 0;
  let months = 0;
  let value = balance;
  const monthlyRate = Math.pow(1 + apy, 1 / 12) - 1;

  while (value < target && months < 600) {
    value = value * (1 + monthlyRate) + monthly;
    months += 1;
  }
  return months;
}

function addMonths(date, months) {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

function buildRecommendation(values, holdings, contribution) {
  const total = Object.values(values).reduce((sum, value) => sum + value, 0);
  const postContributionTotal = total + contribution;

  const shortfalls = Object.entries(holdings).map(([ticker, holding]) => {
    const targetValue = postContributionTotal * holding.target;
    return [ticker, Math.max(targetValue - values[ticker], 0)];
  });

  shortfalls.sort((a, b) => b[1] - a[1]);
  const primary = shortfalls[0][0];
  const totalShortfall = shortfalls.reduce((sum, [, value]) => sum + value, 0);

  const split = shortfalls
    .map(([ticker, value]) => [
      ticker,
      totalShortfall > 0
        ? Math.round((value / totalShortfall) * contribution / 10) * 10
        : 0,
    ])
    .filter(([, value]) => value > 0);

  const splitTotal = split.reduce((sum, [, value]) => sum + value, 0);
  if (split.length && splitTotal !== contribution) {
    split[0][1] += contribution - splitTotal;
  }

  return {
    primary,
    primaryShortfall: shortfalls[0][1],
    split,
  };
}

function renderCharts(values, holdings, hys) {
  const tickers = Object.keys(holdings);
  const portfolioTotal = Object.values(values).reduce((sum, value) => sum + value, 0);

  if (allocationChart) allocationChart.destroy();
  allocationChart = new Chart($("allocationChart"), {
    type: "pie",
    data: {
      labels: tickers,
      datasets: [{ data: tickers.map((ticker) => values[ticker]) }],
    },
    options: { plugins: { legend: { position: "bottom" } } },
  });

  if (targetChart) targetChart.destroy();
  targetChart = new Chart($("targetChart"), {
    type: "bar",
    data: {
      labels: tickers,
      datasets: [
        {
          label: "Current %",
          data: tickers.map((ticker) =>
            portfolioTotal > 0 ? (values[ticker] / portfolioTotal) * 100 : 0
          ),
        },
        {
          label: "Target %",
          data: tickers.map((ticker) => holdings[ticker].target * 100),
        },
      ],
    },
    options: {
      plugins: { legend: { position: "bottom" } },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { callback: (value) => `${value}%` },
        },
      },
    },
  });

  const labels = [];
  const forecast = [];
  let balance = hys.balance;
  const monthlyRate = Math.pow(1 + hys.apy, 1 / 12) - 1;

  for (let i = 0; i <= 18; i += 1) {
    labels.push(
      addMonths(new Date(), i).toLocaleDateString("en-US", {
        month: "short",
        year: "2-digit",
      })
    );
    forecast.push(balance);
    balance = balance * (1 + monthlyRate) + hys.monthly_contribution;
  }

  if (hysChart) hysChart.destroy();
  hysChart = new Chart($("hysChart"), {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Projected HYS balance",
          data: forecast,
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.25,
        },
      ],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        y: {
          ticks: { callback: (value) => money(Number(value)) },
        },
      },
    },
  });
}


function projectRetirement(retirement) {
  const dob = new Date(`${retirement.date_of_birth}T12:00:00`);
  const endDate = new Date(
    dob.getFullYear() + retirement.projection_age,
    dob.getMonth(),
    dob.getDate()
  );
  const contributionEnd = new Date(`${retirement.contribution_end_date}T23:59:59`);
  const monthlyRate = Math.pow(1 + retirement.annual_return, 1 / 12) - 1;

  const labels = [];
  const values = [];
  let value = retirement.balance;
  let current = new Date();
  current = new Date(current.getFullYear(), current.getMonth(), 1);

  while (current <= endDate) {
    labels.push(
      current.toLocaleDateString("en-US", { month: "short", year: "numeric" })
    );
    values.push(value);

    value *= 1 + monthlyRate;
    if (current <= contributionEnd) {
      value += retirement.monthly_contribution;
    }
    current.setMonth(current.getMonth() + 1);
  }

  return {
    labels,
    values,
    finalValue: values.length ? values[values.length - 1] : retirement.balance,
    endDate,
  };
}

function renderRetirement(retirement) {
  const projection = projectRetirement(retirement);
  const contributionEnd = new Date(`${retirement.contribution_end_date}T12:00:00`);
  const growth = projection.finalValue - retirement.balance;

  $("retirementValue").textContent = money(retirement.balance);
  $("retirementCurrent").textContent = money(retirement.balance);
  $("retirementContribution").textContent = money(retirement.monthly_contribution);
  $("retirementContributionEnd").textContent = contributionEnd.toLocaleDateString(
    "en-US",
    { month: "long", year: "numeric" }
  );
  $("retirementReturn").textContent = pct(retirement.annual_return);
  $("retirementProjected").textContent = money(projection.finalValue);
  $("retirementGrowth").textContent = signedMoney(growth);
  $("retirementGrowth").className = growth >= 0 ? "good" : "bad";

  if (retirementChart) retirementChart.destroy();
  retirementChart = new Chart($("retirementChart"), {
    type: "line",
    data: {
      labels: projection.labels,
      datasets: [{
        label: "Projected 401(k)",
        data: projection.values,
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.2
      }]
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { maxTicksLimit: 10 } },
        y: { ticks: { callback: (value) => money(Number(value)) } }
      }
    }
  });
}


function filterHistoryByRange(snapshots, rangeValue) {
  if (rangeValue === "all") return snapshots;
  const days = Number(rangeValue);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return snapshots.filter((row) => new Date(`${row.date}T12:00:00`) >= cutoff);
}

function renderHistoryChart() {
  const selectedRange = $("historyRange").value;
  const rows = filterHistoryByRange(historySnapshots, selectedRange);

  if (historyChart) historyChart.destroy();
  historyChart = new Chart($("historyChart"), {
    type: "line",
    data: {
      labels: rows.map((row) =>
        new Date(`${row.date}T12:00:00`).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: rows.length > 365 ? "2-digit" : undefined,
        })
      ),
      datasets: [{
        label: "Tracked assets",
        data: rows.map((row) => row.tracked_assets),
        borderWidth: 2,
        pointRadius: rows.length <= 31 ? 2 : 0,
        tension: 0.18,
      }],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { maxTicksLimit: 10 } },
        y: { ticks: { callback: (value) => money(Number(value)) } },
      },
    },
  });
}

function renderHistory(historyData) {
  historySnapshots = Array.isArray(historyData.snapshots)
    ? historyData.snapshots
    : [];

  if (!historySnapshots.length) {
    $("historyStatus").textContent =
      "No snapshots yet. Run the price workflow once after installing this update.";
    $("historyStart").textContent = "—";
    $("historyLatest").textContent = "—";
    $("historyChange").textContent = "—";
    $("historyCount").textContent = "0";
    $("historyBody").innerHTML =
      '<tr><td colspan="6">No history has been recorded yet.</td></tr>';
    renderHistoryChart();
    return;
  }

  const first = historySnapshots[0];
  const latest = historySnapshots[historySnapshots.length - 1];
  const change = latest.tracked_assets - first.tracked_assets;

  $("historyStatus").textContent = historyData.updated_at
    ? `History updated ${new Date(historyData.updated_at).toLocaleString()}`
    : "History loaded";
  $("historyStart").textContent = new Date(
    `${first.date}T12:00:00`
  ).toLocaleDateString("en-US");
  $("historyLatest").textContent = money(latest.tracked_assets);
  $("historyChange").textContent = signedMoney(change);
  $("historyChange").className = change >= 0 ? "good" : "bad";
  $("historyCount").textContent = historySnapshots.length.toLocaleString("en-US");

  const recentRows = historySnapshots.slice(-10).reverse();
  $("historyBody").innerHTML = recentRows
    .map(
      (row) => `<tr>
        <td>${new Date(`${row.date}T12:00:00`).toLocaleDateString("en-US")}</td>
        <td>${money(row.tracked_assets)}</td>
        <td>${money(row.retirement_401k_value)}</td>
        <td>${money(row.brokerage_value)}</td>
        <td>${money(row.hys_value)}</td>
        <td>${money(row.mu_value)}</td>
      </tr>`
    )
    .join("");

  renderHistoryChart();
}

function renderDashboard(portfolio, priceData) {
  const holdings = portfolio.holdings;
  const prices = priceData.prices || {};
  const values = {};

  let brokerageValue = 0;
  let invested = 0;
  let annualDividends = 0;

  for (const [ticker, holding] of Object.entries(holdings)) {
    const price = Number(prices[ticker]);
    const validPrice = Number.isFinite(price) && price > 0 ? price : 0;
    values[ticker] = validPrice * holding.shares;
    brokerageValue += values[ticker];
    invested += holding.cost_basis;
    annualDividends += values[ticker] * holding.dividend_yield_estimate;
  }

  const muPrice = Number(prices[portfolio.micron.ticker]);
  const validMuPrice = Number.isFinite(muPrice) && muPrice > 0 ? muPrice : 0;
  const muValue = validMuPrice * portfolio.micron.vested_shares;
  const totalGain = brokerageValue - invested;

  $("trackedAssets").textContent = money(
    brokerageValue + portfolio.hys.balance + muValue + portfolio.retirement_401k.balance
  );
  $("brokerageValue").textContent = money(brokerageValue);
  $("hysValue").textContent = money(portfolio.hys.balance);
  $("muValue").textContent = money(muValue);
  $("totalInvested").textContent = money(invested);
  $("totalGain").textContent = signedMoney(totalGain);
  $("totalGain").className = totalGain >= 0 ? "good" : "bad";
  $("totalReturn").textContent = pct(invested > 0 ? totalGain / invested : NaN);
  $("totalReturn").className = totalGain >= 0 ? "good" : "bad";
  $("annualDividends").textContent = money(annualDividends);

  const tbody = $("portfolioBody");
  tbody.innerHTML = "";

  for (const [ticker, holding] of Object.entries(holdings)) {
    const price = Number(prices[ticker]);
    const marketValue = values[ticker];
    const gain = marketValue - holding.cost_basis;
    const allocation =
      brokerageValue > 0 ? marketValue / brokerageValue : 0;

    tbody.insertAdjacentHTML(
      "beforeend",
      `<tr>
        <td><strong>${ticker}</strong></td>
        <td>${holding.shares.toFixed(ticker === "FSKAX" ? 3 : 0)}</td>
        <td>${money(holding.cost_basis / holding.shares)}</td>
        <td>${money(price)}</td>
        <td>${money(marketValue)}</td>
        <td class="${gain >= 0 ? "good" : "bad"}">${signedMoney(gain)}</td>
        <td class="${gain >= 0 ? "good" : "bad"}">${pct(
          holding.cost_basis > 0 ? gain / holding.cost_basis : NaN
        )}</td>
        <td>${pct(allocation)}</td>
        <td>${pct(holding.target)}</td>
      </tr>`
    );
  }

  const rec = buildRecommendation(
    values,
    holdings,
    portfolio.brokerage_monthly_contribution
  );

  $("primaryRecommendation").innerHTML =
    `<strong>Primary recommendation:</strong> Put the next ${money(
      portfolio.brokerage_monthly_contribution
    )} into <strong>${rec.primary}</strong>. ` +
    `It is about ${money(
      rec.primaryShortfall
    )} below its target value after the next contribution.`;

  $("splitRecommendation").innerHTML =
    `<strong>Balanced split:</strong> ${rec.split
      .map(([ticker, amount]) => `${ticker} ${money(amount)}`)
      .join(" · ")}`;

  $("playbookBuy").textContent = `Buy ${rec.primary}`;
  $("playbookReason").textContent =
    `${rec.primary} has the largest target-allocation shortfall.`;

  const months = monthsToGoal(
    portfolio.hys.balance,
    portfolio.hys.target,
    portfolio.hys.monthly_contribution,
    portfolio.hys.apy
  );

  $("hysCurrent").textContent = money(portfolio.hys.balance);
  $("hysTargetLabel").textContent = `Goal: ${money(portfolio.hys.target)}`;
  $("hysRemaining").textContent = money(
    Math.max(portfolio.hys.target - portfolio.hys.balance, 0)
  );
  $("hysContribution").textContent = money(
    portfolio.hys.monthly_contribution
  );
  $("hysApy").textContent = pct(portfolio.hys.apy);
  $("hysGoalDate").textContent =
    months === 0
      ? "Goal reached"
      : addMonths(new Date(), months).toLocaleDateString("en-US", {
          month: "long",
          year: "numeric",
        });
  $("hysInterest").textContent = money(
    portfolio.hys.balance * portfolio.hys.apy
  );
  $("hysBar").style.width = `${Math.min(
    (portfolio.hys.balance / portfolio.hys.target) * 100,
    100
  )}%`;

  $("muShares").textContent =
    portfolio.micron.vested_shares.toLocaleString("en-US");
  $("muPrice").textContent = money(validMuPrice);
  $("muCurrentValue").textContent = money(muValue);
  $("muConcentration").textContent = pct(
    brokerageValue > 0 ? muValue / brokerageValue : NaN
  );

  const timeline = $("vestingTimeline");
  timeline.innerHTML = "";
  for (const event of portfolio.micron.vesting_events) {
    const eventDate = new Date(`${event.date}T12:00:00`);
    timeline.insertAdjacentHTML(
      "beforeend",
      `<li>
        <strong>${eventDate.toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
        })}</strong><br>
        ${event.gross_shares} gross shares · ${event.status}
      </li>`
    );
  }

  $("priceStatus").textContent = priceData.updated_at
    ? `Prices updated ${new Date(priceData.updated_at).toLocaleString()}`
    : "Prices not updated yet";

  renderRetirement(portfolio.retirement_401k);
  renderCharts(values, holdings, portfolio.hys);
}

async function init() {
  try {
    $("priceStatus").textContent = "Loading dashboard data…";
    const [portfolio, prices, history] = await Promise.all([
      loadJson("data/portfolio.json"),
      loadJson("data/prices.json"),
      loadJson("data/history.json"),
    ]);
    renderDashboard(portfolio, prices);
    renderHistory(history);
  } catch (error) {
    console.error(error);
    $("priceStatus").textContent = "Dashboard data could not load";
  }
}

$("historyRange").addEventListener("change", renderHistoryChart);

$("themeToggle").addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme");
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("dashboardTheme", next);
  init();
});

const savedTheme = localStorage.getItem("dashboardTheme");
if (savedTheme) {
  document.documentElement.setAttribute("data-theme", savedTheme);
}

init();
