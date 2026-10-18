import Chart from 'chart.js/auto';
import { fetchStockData } from './src/dataFetcher.js';
import {
  computeStockStats,
  calculatePortfolioMetrics,
  computePortfolioHistory,
  computeRollingCorrelation
} from './src/portfolioMath.js';
import { generateVulcanAnalysis } from './src/llmAdvisor.js';
import { playLcarsClick, playLcarsLock, playLcarsChime, toggleSound } from './src/audio.js';

// LocalStorage Keys
const STORAGE_KEYS_ID = 'vulcan_finance_keys_v1';
const STORAGE_CONFIG_ID = 'vulcan_finance_config_v1';

// Default State
let state = {
  investmentAmount: 10000,
  tickers: ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN'],
  twelveDataKey: '',
  openRouterKey: '',
  stocks: [
    { ticker: 'AAPL', weight: 20, locked: false },
    { ticker: 'MSFT', weight: 20, locked: false },
    { ticker: 'NVDA', weight: 20, locked: false },
    { ticker: 'GOOGL', weight: 20, locked: false },
    { ticker: 'AMZN', weight: 20, locked: false }
  ],
  selectedCorrPair: [0, 1] // Indices of stocks to correlate
};

let rawStockData = null; // { TICKER: [ { date, close, ... } ] }
let computedStats = null;
let charts = {
  rollingCorr: null,
  performanceComp: null,
  methodsComp: null,
  weightsComp: null
};

// Colors for Vulcan LCARS styling in Chart.js
const LCARS_COLORS = {
  amber: '#ff9c00',
  copper: '#d96b27',
  gold: '#e5b324',
  violet: '#a855f7',
  cyan: '#38bdf8',
  green: '#22c55e',
  red: '#ef4444',
  line: '#2e384d',
  charcoal: '#1e2433'
};

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
  loadSavedState();
  setupEventListeners();
  runAnalysis();
});

/**
 * Load persisted API keys and state from localStorage
 */
function loadSavedState() {
  try {
    const savedKeys = localStorage.getItem(STORAGE_KEYS_ID);
    if (savedKeys) {
      const keys = JSON.parse(savedKeys);
      state.twelveDataKey = keys.twelveDataKey || '';
      state.openRouterKey = keys.openRouterKey || '';
      document.getElementById('twelvedata-key').value = state.twelveDataKey;
      document.getElementById('openrouter-key').value = state.openRouterKey;
    }

    const savedConfig = localStorage.getItem(STORAGE_CONFIG_ID);
    if (savedConfig) {
      const config = JSON.parse(savedConfig);
      if (config.investmentAmount) {
        state.investmentAmount = Number(config.investmentAmount);
        document.getElementById('investment-amount').value = state.investmentAmount;
      }
      if (Array.isArray(config.tickers) && config.tickers.length === 5) {
        state.tickers = config.tickers;
        state.tickers.forEach((t, i) => {
          const input = document.getElementById(`ticker-${i}`);
          if (input) input.value = t;
        });
      }
      if (Array.isArray(config.stocks) && config.stocks.length === 5) {
        state.stocks = config.stocks;
      }
    }
  } catch (err) {
    console.warn('Failed to load saved state from localStorage:', err);
  }
}

/**
 * Persist keys and configuration state to localStorage
 */
function saveStateToLocalStorage() {
  try {
    localStorage.setItem(STORAGE_KEYS_ID, JSON.stringify({
      twelveDataKey: state.twelveDataKey,
      openRouterKey: state.openRouterKey
    }));

    localStorage.setItem(STORAGE_CONFIG_ID, JSON.stringify({
      investmentAmount: state.investmentAmount,
      tickers: state.tickers,
      stocks: state.stocks
    }));
  } catch (err) {
    console.warn('Failed to save to localStorage:', err);
  }
}

/**
 * Setup Event Listeners
 */
function setupEventListeners() {
  // Config Form Submission
  const form = document.getElementById('portfolio-config-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    playLcarsClick();

    // Read values
    state.investmentAmount = Number(document.getElementById('investment-amount').value) || 10000;
    state.twelveDataKey = document.getElementById('twelvedata-key').value.trim();
    state.openRouterKey = document.getElementById('openrouter-key').value.trim();

    const newTickers = [];
    for (let i = 0; i < 5; i++) {
      const val = document.getElementById(`ticker-${i}`).value.trim().toUpperCase();
      newTickers.push(val || `STK${i + 1}`);
    }
    state.tickers = newTickers;

    // Update stock ticker labels while preserving weight/lock state
    state.stocks.forEach((s, i) => {
      s.ticker = state.tickers[i];
    });

    saveStateToLocalStorage();
    runAnalysis();
  });

  // Sound Toggle Button
  const soundBtn = document.getElementById('sound-toggle-btn');
  soundBtn.addEventListener('click', () => {
    const isEnabled = toggleSound();
    soundBtn.innerHTML = isEnabled ? '<span class="btn-icon">🔊</span> AUDIO: ON' : '<span class="btn-icon">🔇</span> AUDIO: OFF';
  });

  // Presets Buttons
  document.getElementById('preset-equal').addEventListener('click', () => applyPreset('equal'));
  document.getElementById('preset-invvol').addEventListener('click', () => applyPreset('invvol'));
  document.getElementById('preset-minvar').addEventListener('click', () => applyPreset('minvar'));
  document.getElementById('preset-maxsharpe').addEventListener('click', () => applyPreset('maxsharpe'));

  // Vulcan AI Research Assessment
  document.getElementById('request-analysis-btn').addEventListener('click', async () => {
    playLcarsClick();
    await triggerVulcanAIAnalysis();
  });

  // Rolling Correlation Pair Dropdown
  document.getElementById('corr-pair-select').addEventListener('change', (e) => {
    playLcarsClick();
    const [i, j] = e.target.value.split('-').map(Number);
    state.selectedCorrPair = [i, j];
    updateRollingCorrChart();
  });
}

/**
 * Main Analysis Orchestration
 */
async function runAnalysis() {
  const fetchBtn = document.getElementById('fetch-data-btn');
  fetchBtn.disabled = true;
  fetchBtn.innerText = '⏳ PROCESSING QUANT MATRIX...';

  try {
    rawStockData = await fetchStockData(state.tickers, state.twelveDataKey);
    computedStats = computeStockStats(rawStockData);

    renderSliders();
    renderAssetTable();
    updateMetricsAndCharts();
    populatePairSelect();

  } catch (err) {
    alert(`Error running analysis: ${err.message}`);
  } finally {
    fetchBtn.disabled = false;
    fetchBtn.innerText = '⚡ COMPUTE VULCAN MARKET MATRIX';
  }
}

/**
 * Render 5 Co-dependent Sliders with Lock Buttons
 */
function renderSliders() {
  const container = document.getElementById('sliders-list');
  container.innerHTML = '';

  state.stocks.forEach((stock, idx) => {
    const row = document.createElement('div');
    row.className = `slider-row ${stock.locked ? 'locked' : ''}`;
    row.id = `slider-row-${idx}`;

    const dollarVal = (state.investmentAmount * (stock.weight / 100)).toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD'
    });

    row.innerHTML = `
      <div class="ticker-tag">${stock.ticker}</div>
      <button type="button" class="lock-btn ${stock.locked ? 'active' : ''}" id="lock-btn-${idx}" title="${stock.locked ? 'Unlock slider' : 'Lock slider'}">
        ${stock.locked ? '🔒' : '🔓'}
      </button>
      <div class="slider-input-wrapper">
        <input type="range" class="slider-control" id="slider-range-${idx}" min="0" max="100" step="0.5" value="${stock.weight.toFixed(1)}" ${stock.locked ? 'disabled' : ''} />
      </div>
      <input type="number" class="weight-val-input" id="slider-num-${idx}" min="0" max="100" step="0.5" value="${stock.weight.toFixed(1)}" ${stock.locked ? 'disabled' : ''} />
      <div class="dollar-val-label" id="dollar-val-${idx}">${dollarVal}</div>
    `;

    container.appendChild(row);

    // Event Listeners for Lock Toggle
    const lockBtn = row.querySelector(`#lock-btn-${idx}`);
    lockBtn.addEventListener('click', () => {
      stock.locked = !stock.locked;
      playLcarsLock();
      saveStateToLocalStorage();
      renderSliders();
    });

    // Range Slider Drag Handler
    const rangeInput = row.querySelector(`#slider-range-${idx}`);
    rangeInput.addEventListener('input', (e) => {
      onSliderChange(idx, parseFloat(e.target.value));
    });

    // Numerical Weight Input Handler
    const numInput = row.querySelector(`#slider-num-${idx}`);
    numInput.addEventListener('change', (e) => {
      onSliderChange(idx, parseFloat(e.target.value) || 0);
    });
  });

  updateTotalWeightBadge();
}

/**
 * Co-Dependent Slider Weight Rebalancer Logic
 * Ensures total weight strictly sums to 100.0%
 */
function onSliderChange(changedIdx, newWeightVal) {
  playLcarsClick();

  // Clamp new weight value between 0 and 100
  let targetVal = Math.max(0, Math.min(100, newWeightVal));

  // Sum of weights of locked sliders excluding changedIdx
  const lockedSumExcludingSelf = state.stocks.reduce((sum, s, idx) => {
    return (idx !== changedIdx && s.locked) ? sum + s.weight : sum;
  }, 0);

  // Maximum weight available for changedIdx
  const maxAvailable = 100 - lockedSumExcludingSelf;
  if (targetVal > maxAvailable) {
    targetVal = maxAvailable;
  }

  const oldVal = state.stocks[changedIdx].weight;
  state.stocks[changedIdx].weight = targetVal;

  const diff = targetVal - oldVal;

  // Distribute (-diff) across all OTHER unlocked sliders
  const otherUnlockedIndices = state.stocks
    .map((s, idx) => ({ s, idx }))
    .filter(item => item.idx !== changedIdx && !item.s.locked)
    .map(item => item.idx);

  if (otherUnlockedIndices.length > 0) {
    const sumOtherUnlocked = otherUnlockedIndices.reduce((sum, i) => sum + state.stocks[i].weight, 0);

    if (sumOtherUnlocked > 0) {
      let remainingToDistribute = -diff;
      otherUnlockedIndices.forEach((i, position) => {
        if (position === otherUnlockedIndices.length - 1) {
          // Assign remaining balance to last unlocked element to eliminate floating point rounding error
          state.stocks[i].weight = Math.max(0, state.stocks[i].weight + remainingToDistribute);
        } else {
          const ratio = state.stocks[i].weight / sumOtherUnlocked;
          const delta = -diff * ratio;
          state.stocks[i].weight = Math.max(0, state.stocks[i].weight + delta);
          remainingToDistribute -= delta;
        }
      });
    } else {
      // If all other unlocked sliders were 0%, distribute remaining equally
      const equalShare = (100 - targetVal - lockedSumExcludingSelf) / otherUnlockedIndices.length;
      otherUnlockedIndices.forEach(i => {
        state.stocks[i].weight = Math.max(0, equalShare);
      });
    }
  }

  // Normalize all unlocked weights to guarantee sum == 100
  normalizeUnlockedWeights();
  updateSliderUI();
  updateMetricsAndCharts();
  saveStateToLocalStorage();
}

function normalizeUnlockedWeights() {
  const lockedSum = state.stocks.reduce((sum, s) => s.locked ? sum + s.weight : sum, 0);
  const targetUnlockedSum = 100 - lockedSum;

  const unlockedIndices = state.stocks
    .map((s, idx) => ({ s, idx }))
    .filter(item => !item.s.locked)
    .map(item => item.idx);

  if (unlockedIndices.length > 0) {
    const currentUnlockedSum = unlockedIndices.reduce((sum, i) => sum + state.stocks[i].weight, 0);
    if (currentUnlockedSum > 0) {
      unlockedIndices.forEach(i => {
        state.stocks[i].weight = (state.stocks[i].weight / currentUnlockedSum) * targetUnlockedSum;
      });
    }
  }
}

/**
 * Fast UI Update of Slider values without re-creating DOM
 */
function updateSliderUI() {
  state.stocks.forEach((stock, idx) => {
    const rangeInput = document.getElementById(`slider-range-${idx}`);
    const numInput = document.getElementById(`slider-num-${idx}`);
    const dollarLabel = document.getElementById(`dollar-val-${idx}`);

    if (rangeInput) rangeInput.value = stock.weight.toFixed(1);
    if (numInput) numInput.value = stock.weight.toFixed(1);
    if (dollarLabel) {
      dollarLabel.innerText = (state.investmentAmount * (stock.weight / 100)).toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD'
      });
    }
  });

  updateTotalWeightBadge();
}

function updateTotalWeightBadge() {
  const total = state.stocks.reduce((sum, s) => sum + s.weight, 0);
  const badge = document.getElementById('total-weight-val');
  if (badge) {
    badge.innerText = `${total.toFixed(1)}%`;
    badge.style.color = Math.abs(total - 100) < 0.1 ? LCARS_COLORS.amber : LCARS_COLORS.red;
  }
}

/**
 * Apply Optimization Presets (Equal Weight, Inverse Volatility, Min Variance, Max Sharpe)
 */
function applyPreset(presetType) {
  if (!computedStats) return;
  playLcarsChime();

  let targetWeights = [];
  if (presetType === 'equal') {
    targetWeights = computedStats.weights.equal_weight;
  } else if (presetType === 'invvol') {
    targetWeights = computedStats.weights.inverse_vol;
  } else if (presetType === 'minvar') {
    targetWeights = computedStats.weights.min_variance;
  } else if (presetType === 'maxsharpe') {
    targetWeights = computedStats.weights.max_sharpe;
  }

  targetWeights.forEach((w, i) => {
    state.stocks[i].weight = w * 100;
  });

  renderSliders();
  updateMetricsAndCharts();
  saveStateToLocalStorage();
}

/**
 * Render Stock Asset Statistics Table
 */
function renderAssetTable() {
  const tbody = document.getElementById('asset-stats-tbody');
  tbody.innerHTML = '';

  if (!computedStats) return;

  const { tickers, priceMatrix, annReturns, annVols, weights } = computedStats;

  tickers.forEach((t, i) => {
    const latestPrice = priceMatrix[i][priceMatrix[i].length - 1];
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${t}</strong></td>
      <td>$${latestPrice.toFixed(2)}</td>
      <td class="${annReturns[i] >= 0 ? 'positive' : 'negative'}">${(annReturns[i] * 100).toFixed(2)}%</td>
      <td>${(annVols[i] * 100).toFixed(2)}%</td>
      <td>${(weights.inverse_vol[i] * 100).toFixed(1)}%</td>
      <td>${(weights.min_variance[i] * 100).toFixed(1)}%</td>
      <td>${(weights.max_sharpe[i] * 100).toFixed(1)}%</td>
      <td style="color: ${LCARS_COLORS.amber}; font-weight: 700;">${state.stocks[i].weight.toFixed(1)}%</td>
    `;
    tbody.appendChild(tr);
  });
}

/**
 * Update Calculated KPI Return Summary Cards & Charts
 */
function updateMetricsAndCharts() {
  if (!computedStats || !rawStockData) return;

  const customWeights = state.stocks.map(s => s.weight / 100);
  const metrics = calculatePortfolioMetrics(customWeights, computedStats);

  // Update KPI Cards
  const totalVal = state.investmentAmount * (1 + metrics.expReturn);
  const gainVal = totalVal - state.investmentAmount;
  const gainPct = (metrics.expReturn * 100);

  document.getElementById('kpi-portfolio-val').innerText = totalVal.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD'
  });

  const gainEl = document.getElementById('kpi-gain-val');
  gainEl.innerText = `${gainVal >= 0 ? '+' : ''}${gainVal.toLocaleString('en-US', { style: 'currency', currency: 'USD' })} (${gainPct.toFixed(2)}%)`;
  gainEl.className = `kpi-sub ${gainVal >= 0 ? 'positive' : 'negative'}`;

  document.getElementById('kpi-exp-return').innerText = `${(metrics.expReturn * 100).toFixed(2)}%`;
  document.getElementById('kpi-portfolio-vol').innerText = `${(metrics.annVol * 100).toFixed(2)}%`;
  document.getElementById('kpi-sharpe').innerText = metrics.sharpe.toFixed(2);

  renderAssetTable();

  // Update Charts
  updatePerformanceChart(customWeights);
  updateMethodsChart();
  updateWeightsChart();
  updateRollingCorrChart();
}

/**
 * Populate 90-Day Rolling Correlation Pair Dropdown
 */
function populatePairSelect() {
  const select = document.getElementById('corr-pair-select');
  select.innerHTML = '';
  const tickers = state.tickers;

  for (let i = 0; i < tickers.length; i++) {
    for (let j = i + 1; j < tickers.length; j++) {
      const option = document.createElement('option');
      option.value = `${i}-${j}`;
      option.innerText = `${tickers[i]} / ${tickers[j]}`;
      select.appendChild(option);
    }
  }

  select.value = `${state.selectedCorrPair[0]}-${state.selectedCorrPair[1]}`;
}

/**
 * Chart 1: 90-Day Rolling Correlation Chart
 */
function updateRollingCorrChart() {
  if (!computedStats) return;

  const [i, j] = state.selectedCorrPair;
  const r1 = computedStats.returnMatrix[i];
  const r2 = computedStats.returnMatrix[j];
  const dates = computedStats.dates;

  const rollingData = computeRollingCorrelation(r1, r2, dates, 30);

  const labels = rollingData.map(d => d.date);
  const values = rollingData.map(d => d.corr);

  const ctx = document.getElementById('chart-rolling-corr').getContext('2d');

  if (charts.rollingCorr) charts.rollingCorr.destroy();

  charts.rollingCorr = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: `${state.tickers[i]} vs ${state.tickers[j]} (30D Rolling Corr)`,
        data: values,
        borderColor: LCARS_COLORS.cyan,
        backgroundColor: 'rgba(56, 189, 248, 0.1)',
        borderWidth: 2,
        fill: true,
        tension: 0.3,
        pointRadius: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          min: -1,
          max: 1,
          grid: { color: LCARS_COLORS.line },
          ticks: { color: LCARS_COLORS.cyan }
        },
        x: {
          grid: { color: LCARS_COLORS.line },
          ticks: { color: LCARS_COLORS.cyan, maxTicksLimit: 8 }
        }
      },
      plugins: {
        legend: { labels: { color: LCARS_COLORS.cyan, font: { family: 'Antonio' } } }
      }
    }
  });
}

/**
 * Chart 2: Investment Performance Growth ($) Comparison Chart
 */
function updatePerformanceChart(customWeights) {
  if (!computedStats || !rawStockData) return;

  const dates = computedStats.dates;
  const S0 = state.investmentAmount;

  const histCustom = computePortfolioHistory(customWeights, rawStockData, S0);
  const histEqual = computePortfolioHistory(computedStats.weights.equal_weight, rawStockData, S0);
  const histMinVar = computePortfolioHistory(computedStats.weights.min_variance, rawStockData, S0);
  const histMaxSharpe = computePortfolioHistory(computedStats.weights.max_sharpe, rawStockData, S0);

  const ctx = document.getElementById('chart-performance-comp').getContext('2d');
  if (charts.performanceComp) charts.performanceComp.destroy();

  charts.performanceComp = new Chart(ctx, {
    type: 'line',
    data: {
      labels: dates,
      datasets: [
        {
          label: 'Custom Allocation',
          data: histCustom.map(d => d.value),
          borderColor: LCARS_COLORS.amber,
          borderWidth: 3,
          tension: 0.2,
          pointRadius: 0
        },
        {
          label: 'Equal Weight',
          data: histEqual.map(d => d.value),
          borderColor: LCARS_COLORS.copper,
          borderWidth: 2,
          borderDash: [5, 5],
          tension: 0.2,
          pointRadius: 0
        },
        {
          label: 'Min Variance',
          data: histMinVar.map(d => d.value),
          borderColor: LCARS_COLORS.violet,
          borderWidth: 2,
          tension: 0.2,
          pointRadius: 0
        },
        {
          label: 'Max Sharpe',
          data: histMaxSharpe.map(d => d.value),
          borderColor: LCARS_COLORS.cyan,
          borderWidth: 2,
          tension: 0.2,
          pointRadius: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          grid: { color: LCARS_COLORS.line },
          ticks: {
            color: '#fff',
            callback: (val) => '$' + val.toLocaleString()
          }
        },
        x: {
          grid: { color: LCARS_COLORS.line },
          ticks: { color: '#fff', maxTicksLimit: 8 }
        }
      },
      plugins: {
        legend: { labels: { color: '#fff', font: { family: 'Antonio' } } }
      }
    }
  });
}

/**
 * Chart 3: 3 Calculation Methods Comparison Chart (EqualWeight, MinVariance, MaxSharpe)
 */
function updateMethodsChart() {
  if (!computedStats) return;

  const w = computedStats.weights;

  const mEqual = calculatePortfolioMetrics(w.equal_weight, computedStats);
  const mMinVar = calculatePortfolioMetrics(w.min_variance, computedStats);
  const mMaxSharpe = calculatePortfolioMetrics(w.max_sharpe, computedStats);

  const ctx = document.getElementById('chart-methods-comp').getContext('2d');
  if (charts.methodsComp) charts.methodsComp.destroy();

  charts.methodsComp = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['Expected Return (%)', 'Annualized Volatility (%)', 'Sharpe Ratio'],
      datasets: [
        {
          label: 'EqualWeight',
          data: [mEqual.expReturn * 100, mEqual.annVol * 100, mEqual.sharpe],
          backgroundColor: LCARS_COLORS.copper
        },
        {
          label: 'MinVariance',
          data: [mMinVar.expReturn * 100, mMinVar.annVol * 100, mMinVar.sharpe],
          backgroundColor: LCARS_COLORS.violet
        },
        {
          label: 'MaxSharpe',
          data: [mMaxSharpe.expReturn * 100, mMaxSharpe.annVol * 100, mMaxSharpe.sharpe],
          backgroundColor: LCARS_COLORS.cyan
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          grid: { color: LCARS_COLORS.line },
          ticks: { color: '#fff' }
        },
        x: {
          grid: { color: LCARS_COLORS.line },
          ticks: { color: '#fff', font: { family: 'Antonio' } }
        }
      },
      plugins: {
        legend: { labels: { color: '#fff', font: { family: 'Antonio' } } }
      }
    }
  });
}

/**
 * Chart 4: Portfolio Weights by Method (inverse_vol, min_variance, equal_weight, custom)
 */
function updateWeightsChart() {
  if (!computedStats) return;

  const tickers = state.tickers;
  const w = computedStats.weights;
  const customW = state.stocks.map(s => s.weight);

  const ctx = document.getElementById('chart-weights-comp').getContext('2d');
  if (charts.weightsComp) charts.weightsComp.destroy();

  charts.weightsComp = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: tickers,
      datasets: [
        {
          label: 'Custom Allocation',
          data: customW,
          backgroundColor: LCARS_COLORS.amber
        },
        {
          label: 'Inverse Volatility',
          data: w.inverse_vol.map(v => v * 100),
          backgroundColor: LCARS_COLORS.gold
        },
        {
          label: 'Min Variance',
          data: w.min_variance.map(v => v * 100),
          backgroundColor: LCARS_COLORS.violet
        },
        {
          label: 'Equal Weight',
          data: w.equal_weight.map(v => v * 100),
          backgroundColor: LCARS_COLORS.copper
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          min: 0,
          max: 100,
          grid: { color: LCARS_COLORS.line },
          ticks: {
            color: '#fff',
            callback: (val) => val + '%'
          }
        },
        x: {
          grid: { color: LCARS_COLORS.line },
          ticks: { color: '#fff', font: { family: 'Orbitron' } }
        }
      },
      plugins: {
        legend: { labels: { color: '#fff', font: { family: 'Antonio' } } }
      }
    }
  });
}

/**
 * Trigger Vulcan AI Advisory Note
 */
async function triggerVulcanAIAnalysis() {
  const noteBox = document.getElementById('vulcan-note-content');
  noteBox.innerHTML = '<span class="placeholder-text">⏳ TRANSMITTING QUANT DATA TO VULCAN SCIENCE DIRECTORATE...</span>';

  const customWeights = state.stocks.map(s => s.weight / 100);
  const metrics = calculatePortfolioMetrics(customWeights, computedStats);

  const noteText = await generateVulcanAnalysis(computedStats, metrics, state.openRouterKey);
  noteBox.innerText = noteText;
}
