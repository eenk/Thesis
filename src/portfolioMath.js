// Portfolio Quantitative Analytics Engine
// Computes Returns, Covariance, Volatility, Inverse Volatility, Min Variance, Max Sharpe, and 90-Day Rolling Correlations

/**
 * Calculate daily fractional returns from price series
 * @param {number[]} prices - Array of prices sorted oldest to newest
 */
export function calculateDailyReturns(prices) {
  const returns = [];
  for (let i = 1; i < prices.length; i++) {
    const prev = prices[i - 1];
    const curr = prices[i];
    returns.push((curr - prev) / prev);
  }
  return returns;
}

/**
 * Calculate mean of array
 */
export function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((sum, val) => sum + val, 0) / arr.length;
}

/**
 * Calculate sample standard deviation
 */
export function standardDeviation(arr) {
  if (arr.length <= 1) return 0;
  const avg = mean(arr);
  const variance = arr.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

/**
 * Calculate sample covariance between two return series
 */
export function covariance(arr1, arr2) {
  if (arr1.length !== arr2.length || arr1.length <= 1) return 0;
  const mean1 = mean(arr1);
  const mean2 = mean(arr2);
  let sum = 0;
  for (let i = 0; i < arr1.length; i++) {
    sum += (arr1[i] - mean1) * (arr2[i] - mean2);
  }
  return sum / (arr1.length - 1);
}

/**
 * Calculate Pearson correlation coefficient between two series
 */
export function correlation(arr1, arr2) {
  const std1 = standardDeviation(arr1);
  const std2 = standardDeviation(arr2);
  if (std1 === 0 || std2 === 0) return 0;
  const cov = covariance(arr1, arr2);
  const corr = cov / (std1 * std2);
  return Math.max(-1, Math.min(1, corr));
}

/**
 * Compute full statistics for a set of stock price histories
 * @param {Object} stockDataMap - { TICKER: [ { date, close }, ... ] }
 */
export function computeStockStats(stockDataMap) {
  const tickers = Object.keys(stockDataMap);
  const N = tickers.length;
  if (N === 0) return null;

  // Align dates across all tickers
  const dates = stockDataMap[tickers[0]].map(d => d.date);
  const priceMatrix = tickers.map(t => stockDataMap[t].map(d => d.close));
  const returnMatrix = priceMatrix.map(prices => calculateDailyReturns(prices));

  const T = returnMatrix[0].length; // return count
  const dailyMeans = returnMatrix.map(r => mean(r));
  const dailyVols = returnMatrix.map(r => standardDeviation(r));

  // Annualized metrics (assuming 252 trading days)
  const annReturns = dailyMeans.map(m => Math.pow(1 + m, 252) - 1);
  const annVols = dailyVols.map(v => v * Math.sqrt(252));

  // Build Covariance Matrix (Daily)
  const covMatrix = [];
  for (let i = 0; i < N; i++) {
    covMatrix[i] = [];
    for (let j = 0; j < N; j++) {
      covMatrix[i][j] = covariance(returnMatrix[i], returnMatrix[j]);
    }
  }

  // 1. Equal Weight Strategy (1/N)
  const equalWeights = Array(N).fill(1 / N);

  // 2. Inverse Volatility Strategy
  const invVols = annVols.map(v => (v > 0 ? 1 / v : 1));
  const invVolSum = invVols.reduce((a, b) => a + b, 0);
  const invVolWeights = invVols.map(v => v / invVolSum);

  // 3. Minimum Variance Portfolio Optimization
  const minVarWeights = optimizeMinVariance(covMatrix, N);

  // 4. Maximum Sharpe Portfolio Optimization (r_f = 0.02)
  const maxSharpeWeights = optimizeMaxSharpe(annReturns, covMatrix, N, 0.02);

  return {
    tickers,
    dates,
    priceMatrix,
    returnMatrix,
    dailyMeans,
    dailyVols,
    annReturns,
    annVols,
    covMatrix,
    weights: {
      equal_weight: equalWeights,
      inverse_vol: invVolWeights,
      min_variance: minVarWeights,
      max_sharpe: maxSharpeWeights
    }
  };
}

/**
 * Exact Euclidean Projection onto the Probability Simplex: { w >= 0, sum(w) = 1 }
 * Time Complexity: O(N log N)
 */
export function projectToSimplex(v) {
  const n = v.length;
  const indices = Array.from({ length: n }, (_, i) => i);
  indices.sort((a, b) => v[b] - v[a]);

  let cumulativeSum = 0;
  let rho = 0;
  for (let i = 0; i < n; i++) {
    cumulativeSum += v[indices[i]];
    if (v[indices[i]] + (1 - cumulativeSum) / (i + 1) > 0) {
      rho = i;
    }
  }

  let sumRho = 0;
  for (let i = 0; i <= rho; i++) {
    sumRho += v[indices[i]];
  }
  const theta = (1 - sumRho) / (rho + 1);

  return v.map(val => Math.max(0, val + theta));
}

/**
 * Projected gradient descent optimization for Minimum Variance portfolio (scales to any N)
 */
function optimizeMinVariance(covMatrix, N) {
  let w = Array(N).fill(1 / N);
  const maxDiag = Math.max(...covMatrix.map((row, i) => row[i])) || 0.0001;
  const lr = 0.5 / (maxDiag * 2);

  let bestW = [...w];
  let minVar = computePortfolioVariance(w, covMatrix);

  for (let iter = 0; iter < 500; iter++) {
    const grad = Array(N).fill(0);
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        grad[i] += 2 * covMatrix[i][j] * w[j];
      }
    }

    const candidate = projectToSimplex(w.map((wi, i) => wi - lr * grad[i]));
    const currentVar = computePortfolioVariance(candidate, covMatrix);

    if (currentVar < minVar) {
      minVar = currentVar;
      bestW = [...candidate];
    }
    w = candidate;
  }

  return normalizeWeights(bestW);
}

/**
 * Multi-seed projected gradient ascent optimization for Maximum Sharpe ratio portfolio
 */
function optimizeMaxSharpe(annReturns, covMatrix, N, rf = 0.02) {
  // Candidate seed portfolios
  const seeds = [];
  // 1. Equal weight
  seeds.push(Array(N).fill(1 / N));
  // 2. Individual pure assets
  for (let i = 0; i < N; i++) {
    const pure = Array(N).fill(0);
    pure[i] = 1.0;
    seeds.push(pure);
  }
  // 3. Proportional to excess return if positive
  const excess = annReturns.map(r => Math.max(0, r - rf));
  const excessSum = excess.reduce((a, b) => a + b, 0);
  if (excessSum > 0) {
    seeds.push(excess.map(e => e / excessSum));
  }

  let bestWeights = Array(N).fill(1 / N);
  let maxSharpe = -Infinity;

  function evalSharpe(weights) {
    const normW = normalizeWeights(weights);
    const retP = normW.reduce((sum, w, i) => sum + w * annReturns[i], 0);
    const varP = computePortfolioVariance(normW, covMatrix);
    const volP = Math.sqrt(Math.max(1e-8, varP * 252));
    return volP > 0 ? (retP - rf) / volP : -Infinity;
  }

  // Evaluate all initial seeds
  for (const s of seeds) {
    const sh = evalSharpe(s);
    if (sh > maxSharpe) {
      maxSharpe = sh;
      bestWeights = [...s];
    }
  }

  // Projected gradient ascent from best seed
  let currentW = [...bestWeights];
  const lrs = [0.05, 0.01, 0.002];

  for (const lr of lrs) {
    for (let iter = 0; iter < 200; iter++) {
      const retP = currentW.reduce((sum, w, i) => sum + w * annReturns[i], 0);
      const varP = computePortfolioVariance(currentW, covMatrix);
      const volP = Math.sqrt(Math.max(1e-8, varP * 252));
      const denom = Math.pow(volP, 3);

      const grad = Array(N).fill(0);
      for (let i = 0; i < N; i++) {
        let covTerm = 0;
        for (let j = 0; j < N; j++) {
          covTerm += covMatrix[i][j] * currentW[j];
        }
        // dS/dw_i = mu_i / volP - ((retP - rf) * 252 * (covMatrix * w)_i) / volP^3
        grad[i] = (annReturns[i] / volP) - ((retP - rf) * 252 * covTerm) / denom;
      }

      const nextW = projectToSimplex(currentW.map((wi, i) => wi + lr * grad[i]));
      const nextSharpe = evalSharpe(nextW);

      if (nextSharpe > maxSharpe) {
        maxSharpe = nextSharpe;
        bestWeights = [...nextW];
        currentW = nextW;
      } else {
        currentW = nextW;
      }
    }
  }

  return normalizeWeights(bestWeights);
}

/**
 * Compute portfolio daily variance w^T * Cov * w
 */
export function computePortfolioVariance(weights, covMatrix) {
  let v = 0;
  const N = weights.length;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      v += weights[i] * weights[j] * covMatrix[i][j];
    }
  }
  return v;
}

/**
 * Normalize array of weights to sum to 1.0
 */
export function normalizeWeights(weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) return Array(weights.length).fill(1 / weights.length);
  return weights.map(w => w / sum);
}

/**
 * Calculate Portfolio Metrics for a given weight vector
 */
export function calculatePortfolioMetrics(weights, stats, rf = 0.02) {
  const N = weights.length;
  const normW = normalizeWeights(weights);

  // Expected Annual Return
  const expReturn = normW.reduce((sum, w, i) => sum + w * stats.annReturns[i], 0);

  // Annualized Volatility
  const dailyVar = computePortfolioVariance(normW, stats.covMatrix);
  const annVol = Math.sqrt(dailyVar * 252);

  // Sharpe Ratio
  const sharpe = annVol > 0 ? (expReturn - rf) / annVol : 0;

  return {
    weights: normW,
    expReturn,
    annVol,
    sharpe
  };
}

/**
 * Compute historical cumulative portfolio value trajectory ($ amount growth over time)
 */
export function computePortfolioHistory(weights, stockDataMap, initialInvestment = 10000) {
  const tickers = Object.keys(stockDataMap);
  const normW = normalizeWeights(weights);
  const dates = stockDataMap[tickers[0]].map(d => d.date);
  const numDays = dates.length;

  // Normalized price index starting at 1.0 for each stock
  const priceSeries = tickers.map(t => {
    const prices = stockDataMap[t].map(d => d.close);
    const startP = prices[0];
    return prices.map(p => p / startP);
  });

  const portfolioValues = [];
  for (let d = 0; d < numDays; d++) {
    let dayIndexVal = 0;
    for (let i = 0; i < tickers.length; i++) {
      dayIndexVal += normW[i] * priceSeries[i][d];
    }
    portfolioValues.push({
      date: dates[d],
      value: initialInvestment * dayIndexVal,
      returnPct: (dayIndexVal - 1) * 100
    });
  }

  return portfolioValues;
}

/**
 * Compute 90-Day Rolling Pairwise Correlations over time
 * @param {number[]} returnSeries1
 * @param {number[]} returnSeries2
 * @param {string[]} dates - Daily dates array
 * @param {number} windowSize - Rolling window (e.g. 30 trading days)
 */
export function computeRollingCorrelation(returnSeries1, returnSeries2, dates, windowSize = 30) {
  const result = [];
  // returnSeries length is dates.length - 1
  for (let i = windowSize; i <= returnSeries1.length; i++) {
    const sub1 = returnSeries1.slice(i - windowSize, i);
    const sub2 = returnSeries2.slice(i - windowSize, i);
    const corrVal = correlation(sub1, sub2);
    result.push({
      date: dates[i], // Date corresponding to window end
      corr: corrVal
    });
  }
  return result;
}
