// Vulcan Financial Research Assistant via OpenRouter API

/**
 * Generates Vulcan Research Note via OpenRouter API or Vulcan Logic Engine Fallback
 */
export async function generateVulcanAnalysis(stats, customMetrics, openRouterKey) {
  const { tickers, annReturns, annVols, weights } = stats;

  const summaryData = {
    tickers: tickers.map((t, i) => ({
      ticker: t,
      return: (annReturns[i] * 100).toFixed(2) + '%',
      volatility: (annVols[i] * 100).toFixed(2) + '%',
      inverseVolWeight: (weights.inverse_vol[i] * 100).toFixed(1) + '%',
      minVarWeight: (weights.min_variance[i] * 100).toFixed(1) + '%',
      maxSharpeWeight: (weights.max_sharpe[i] * 100).toFixed(1) + '%'
    })),
    portfolioMetrics: {
      customExpectedReturn: (customMetrics.expReturn * 100).toFixed(2) + '%',
      customVolatility: (customMetrics.annVol * 100).toFixed(2) + '%',
      customSharpe: customMetrics.sharpe.toFixed(2)
    }
  };

  const promptText = `
VULCAN SCIENCE DIRECTORATE FINANCIAL ASSESSMENT:
Assets: ${JSON.stringify(summaryData.tickers, null, 2)}
Active Portfolio State: Expected Return ${summaryData.portfolioMetrics.customExpectedReturn}, Volatility ${summaryData.portfolioMetrics.customVolatility}, Sharpe ${summaryData.portfolioMetrics.customSharpe}.

Provide a concise, strictly logical financial evaluation (2 paragraphs max). Evaluate the efficiency of the inverse volatility distribution versus equal weighting and minimum variance allocations. Speak with Vulcan precision, logical clarity, and reference Vulcan risk principles ("IDIC", "The needs of the portfolio outweigh the desires of speculation").
`;

  if (!openRouterKey || openRouterKey.trim() === '') {
    return generateLocalVulcanNote(summaryData);
  }

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openRouterKey.trim()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'anthropic/claude-3.5-sonnet',
        max_tokens: 1000,
        messages: [
          {
            role: 'system',
            content: 'You are T\'Kael, Senior Quantitative Strategist at the Vulcan Academy of Sciences. You evaluate financial asset portfolios with pure logic, mathematical discipline, and calm Vulcan demeanor.'
          },
          {
            role: 'user',
            content: promptText
          }
        ]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.warn('OpenRouter call returned non-200. Using local Vulcan synthesis.', errText);
      return generateLocalVulcanNote(summaryData);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || generateLocalVulcanNote(summaryData);
  } catch (err) {
    console.warn('OpenRouter fetch failed:', err);
    return generateLocalVulcanNote(summaryData);
  }
}

function generateLocalVulcanNote(summaryData) {
  const topVolAsset = [...summaryData.tickers].sort((a,b) => parseFloat(b.volatility) - parseFloat(a.volatility))[0];
  const lowestVolAsset = [...summaryData.tickers].sort((a,b) => parseFloat(a.volatility) - parseFloat(b.volatility))[0];

  return `
VULCAN SCIENCE DIRECTORATE // LOGICAL ASSESSMENT REPORT:

1. ASSET VOLATILITY DYNAMICS:
   Analysis indicates asset ${topVolAsset.ticker} exhibits maximum variance at ${topVolAsset.volatility} annualized volatility, while ${lowestVolAsset.ticker} demonstrates superior statistical stability at ${lowestVolAsset.volatility}. Under the Inverse Volatility principle (Kli-Kha-Zod), weighting allocation inversely to variance reduces portfolio tail-risk without sacrificing long-term expected yields.

2. ALLOCATION OPTIMALITY:
   The current user-selected portfolio configuration yields an expected return of ${summaryData.portfolioMetrics.customExpectedReturn} with an annualized volatility of ${summaryData.portfolioMetrics.customVolatility} (Sharpe Ratio: ${summaryData.portfolioMetrics.customSharpe}). Speculation is illogical; transitioning allocations toward Minimum Variance or Inverse Volatility ensures optimal capital preservation across all market regimes. Live Long and Prosper.
  `.trim();
}
