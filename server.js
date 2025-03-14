const express = require('express');
const { Connection, PublicKey } = require('@solana/web3.js');
const { MongoClient } = require('mongodb');
const app = express();

const solanaConnection = new Connection('https://mainnet.helius-rpc.com/?api-key=310f8976-ff17-4870-8113-d6f09d056559', 'confirmed');
const mongoUri = process.env.MONGO_URI || 'mongodb+srv://jeetscan_user:Jeet2025!@jeetscan-cluster.mm1fp.mongodb.net/jeetscan?retryWrites=true&w=majority&appName=jeetscan-cluster';
const client = new MongoClient(mongoUri);
let db;

const walletsToTrack = [
  'DfMxre4cKmvogbLrPigxmibVTTQDuzjdXojWzjCXXhzj', // Euris
  'JDd3hy3gQn2V982mi1zqhNqUw1GfV2UL6g76STojCJPN', // West
  'CyaE1VxvBrahnPWkqm5VsdCvyS2QmNht2UFrKJHga54o', // Cented
  'BCnqsPEtA1TkgednYEebRpkmwFRJDCjMQcKZMMtEdArc', // Kreo
  '73LnJ7G9ffBDjEBGgJDdgvLUhD5APLonKrNiHsKDCw5B', // Waddles
  'BTf4A2exGK9BCVDNzy65b9dUzXgMqB4weVkvTMFQsadd', // Kev
  '7ABz8qEFZTHPkovMDsmQkm64DZWN5wRtU7LEtD2ShkQ6', // Red
  'F2SuErm4MviWJ2HzKXk2nuzBC6xe883CFWUDCPz6cyWm', // Earl
  'AJ6MGExeK7FXmeKkKPmALjcdXVStXYokYNv9uVfDRtvo', // Tim
  'GJA1HEbxGnqBhBifH9uQauzXSB53to5rhDrzmKxhSU65', // Latuche
  '8rvAsDKeAcEjEkiZMug9k8v1y8mW6gQQiMobd89Uy7qR'  // Casino
];

const walletNames = {
  'DfMxre4cKmvogbLrPigxmibVTTQDuzjdXojWzjCXXhzj': 'Euris',
  'JDd3hy3gQn2V982mi1zqhNqUw1GfV2UL6g76STojCJPN': 'West',
  'CyaE1VxvBrahnPWkqm5VsdCvyS2QmNht2UFrKJHga54o': 'Cented',
  'BCnqsPEtA1TkgednYEebRpkmwFRJDCjMQcKZMMtEdArc': 'Kreo',
  '73LnJ7G9ffBDjEBGgJDdgvLUhD5APLonKrNiHsKDCw5B': 'Waddles',
  'BTf4A2exGK9BCVDNzy65b9dUzXgMqB4weVkvTMFQsadd': 'Kev',
  '7ABz8qEFZTHPkovMDsmQkm64DZWN5wRtU7LEtD2ShkQ6': 'Red',
  'F2SuErm4MviWJ2HzKXk2nuzBC6xe883CFWUDCPz6cyWm': 'Earl',
  'AJ6MGExeK7FXmeKkKPmALjcdXVStXYokYNv9uVfDRtvo': 'Tim',
  'GJA1HEbxGnqBhBifH9uQauzXSB53to5rhDrzmKxhSU65': 'Latuche',
  '8rvAsDKeAcEjEkiZMug9k8v1y8mW6gQQiMobd89Uy7qR': 'Casino'
};

const currentDateEST = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }).split(',')[0];
const startOfDayEST = Math.floor(new Date(`${currentDateEST} 00:00:00-05:00`).getTime() / 1000);

// Improved rate limiter: 10 requests per second with proper throttling
const REQUESTS_PER_SECOND = 10;
let requestTimestamps = [];

const rateLimit = async () => {
  const now = Date.now();
  requestTimestamps = requestTimestamps.filter(ts => now - ts < 1000);
  if (requestTimestamps.length < REQUESTS_PER_SECOND) {
    requestTimestamps.push(now);
    return;
  }
  const delay = 1000 - (now - requestTimestamps[0]);
  await new Promise(resolve => setTimeout(resolve, delay));
  requestTimestamps.shift();
  requestTimestamps.push(now);
};

// Retry function for handling 429 errors
const withRetry = async (fn, maxRetries = 5, baseDelay = 500) => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await rateLimit();
      return await fn();
    } catch (error) {
      if (error.response && error.response.status === 429) {
        const delay = baseDelay * Math.pow(2, i) + Math.random() * 100;
        console.log(`Server responded with 429 Too Many Requests. Retrying after ${delay}ms delay...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }
  throw new Error('Max retries reached');
};

async function connectDB() {
  if (!db) {
    try {
      await client.connect();
      db = client.db('jeetscan');
      console.log('Connected to MongoDB Atlas');
    } catch (error) {
      console.error('MongoDB Atlas connection error:', error);
      throw error;
    }
  }
  return db;
}

async function getTransactions(wallet, lastBlockTime) {
  const publicKey = new PublicKey(wallet);
  let allSignatures = [];
  let lastSignature = null;
  const startTime = lastBlockTime || startOfDayEST;

  if (!lastBlockTime) {
    console.log(`Fetching all txs for new wallet ${wallet} since ${startTime}`);
    do {
      const options = { limit: 100, before: lastSignature };
      const signatures = await withRetry(() => solanaConnection.getSignaturesForAddress(publicKey, options));
      allSignatures = allSignatures.concat(signatures.filter(tx => tx.blockTime > startTime));
      lastSignature = signatures.length > 0 ? signatures[signatures.length - 1].signature : null;
    } while (lastSignature && allSignatures.length < 1000);
    console.log(`Fetched ${allSignatures.length} signatures for new wallet ${wallet}`);
  } else {
    console.log(`Fetching up to 100 txs for ${wallet} since ${startTime}`);
    const options = { limit: 100, before: lastSignature };
    const signatures = await withRetry(() => solanaConnection.getSignaturesForAddress(publicKey, options));
    allSignatures = signatures.filter(tx => tx.blockTime > startTime);
    console.log(`Fetched ${allSignatures.length} signatures for ${wallet} (capped at 100)`);
  }

  return allSignatures.sort((a, b) => a.blockTime - b.blockTime);
}

async function calculateHoldTime(wallet) {
  const startTime = Date.now();
  console.log(`Calculating hold time for ${wallet}`);
  await connectDB();
  const cached = await db.collection('wallet_daily_stats').findOne({ wallet, date: currentDateEST });
  let lastBlockTime = cached ? cached.lastBlockTime : null;
  let totalHoldTime = cached ? cached.totalHoldTime || 0 : 0;
  let tradeCount = cached ? cached.tradeCount || 0 : 0;
  let lastTimestamp = cached ? cached.lastTimestamp : null;
  let holdTimes = cached && cached.holdTimes ? cached.holdTimes : [];
  let hasNewTrades = false;

  console.log(`Cached data for ${wallet}:`, { lastBlockTime, totalHoldTime, tradeCount, holdTimesLength: holdTimes.length });

  const txSignatures = await getTransactions(wallet, lastBlockTime);
  console.log(`Processing ${txSignatures.length} new transactions for ${wallet}`);
  
  if (txSignatures.length === 0 && cached) {
    console.log(`No new txs for ${wallet}, using cached data`);
    return { avgHoldTime: cached.avgHoldTime, tradeCount: cached.tradeCount, holdTimes, hasNewTrades: false };
  }

  for (const tx of txSignatures) {
    console.log(`Processing tx ${tx.signature}`);
    const txDetails = await withRetry(() => solanaConnection.getParsedTransaction(tx.signature, { maxSupportedTransactionVersion: 0 }));
    if (!txDetails || !txDetails.meta) continue;

    const timestamp = txDetails.blockTime * 1000;
    let wasTrade = false;
    if (txDetails.meta.preTokenBalances && txDetails.meta.postTokenBalances) {
      for (let i = 0; i < txDetails.meta.postTokenBalances.length; i++) {
        if (txDetails.meta.postTokenBalances[i].owner === wallet) {
          const pre = txDetails.meta.preTokenBalances.find(b => b.accountIndex === txDetails.meta.postTokenBalances[i].accountIndex) || { uiTokenAmount: { amount: '0' } };
          if (BigInt(txDetails.meta.postTokenBalances[i].uiTokenAmount.amount) !== BigInt(pre.uiTokenAmount.amount)) {
            wasTrade = true;
            console.log(`Trade detected in ${tx.signature}`);
            break;
          }
        }
      }
    }

    if (wasTrade) {
      tradeCount++;
      hasNewTrades = true;
      if (tradeCount > 1) {
        const holdTime = Math.min((timestamp - lastTimestamp) / 1000, 3600);
        holdTimes.push(holdTime);
        totalHoldTime += holdTime;
        console.log(`Hold time added: ${holdTime}s`);
      }
      lastTimestamp = timestamp;
      lastBlockTime = txDetails.blockTime;
    }
  }

  let avgHoldTime = 0;
  if (tradeCount > 1) {
    const quickTrades = holdTimes.filter(time => time < 120);
    const quickTradeRatio = quickTrades.length / holdTimes.length;
    console.log(`Quick trade ratio for ${wallet}: ${quickTradeRatio} (${quickTrades.length}/${holdTimes.length})`);

    if (quickTradeRatio >= 0.7) {
      avgHoldTime = quickTrades.length > 0 ? quickTrades.reduce((sum, time) => sum + time, 0) / quickTrades.length : 0;
      console.log(`${wallet} classified as Jeet, avgHoldTime based on quick trades: ${avgHoldTime}`);
    } else {
      avgHoldTime = totalHoldTime / (tradeCount - 1);
      console.log(`${wallet} classified as Chad, avgHoldTime based on all trades: ${avgHoldTime}`);
    }
  }

  console.log(`Final stats for ${wallet}:`, { tradeCount, avgHoldTime });

  await db.collection('wallet_daily_stats').updateOne(
    { wallet, date: currentDateEST },
    { $set: { avgHoldTime, tradeCount, totalHoldTime, lastTimestamp, lastBlockTime, holdTimes, lastUpdated: new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }) } },
    { upsert: true }
  );
  console.log(`Saved data for ${wallet} to MongoDB Atlas`);
  const endTime = Date.now();
  console.log(`Processed ${wallet} in ${(endTime - startTime) / 1000} seconds`);

  return { avgHoldTime, tradeCount, holdTimes, hasNewTrades, lastTimestamp };
}

async function updateAllWallets() {
  console.log('Updating all wallets sequentially...');
  const results = [];
  for (const wallet of walletsToTrack) {
    const result = await calculateHoldTime(wallet);
    results.push(result);
  }
  const hasNewTrades = results.some(result => result.hasNewTrades);
  const latestTradeTime = Math.max(...results.map(r => r.lastTimestamp || 0)) / 1000;
  const currentTime = Math.floor(Date.now() / 1000);
  console.log(`Update complete. Has new trades: ${hasNewTrades}, Latest trade time: ${latestTradeTime}, Current time: ${currentTime}`);
  return true;
}

function formatTime(seconds) {
  if (seconds < 60) return `${seconds.toFixed(2)} s`;
  return `${(seconds / 60).toFixed(2)} min`;
}

async function getLatestLeaderboard() {
  await connectDB();
  let leaderboard = await db.collection('wallet_daily_stats').find({ date: currentDateEST }).toArray();
  if (leaderboard.length < walletsToTrack.length) {
    console.log('Incomplete data for today, fetching latest previous data...');
    const latestData = await Promise.all(walletsToTrack.map(async wallet => {
      const latestEntry = await db.collection('wallet_daily_stats')
        .find({ wallet })
        .sort({ lastUpdated: -1 })
        .limit(1)
        .toArray();
      return latestEntry.length > 0 ? latestEntry[0] : {
        wallet,
        avgHoldTime: 0,
        tradeCount: 0,
        holdTimes: [],
        lastUpdated: 'N/A'
      };
    }));
    const walletMap = new Map(leaderboard.map(entry => [entry.wallet, entry]));
    leaderboard = walletsToTrack.map(wallet => walletMap.get(wallet) || latestData.find(d => d.wallet === wallet));
  }
  return leaderboard;
}

app.get('/', async (req, res) => {
  console.log('Root endpoint called');
  try {
    const leaderboard = await getLatestLeaderboard();
    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Jeetscan</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; background: #f0f0f0; }
          h1 { text-align: center; color: #333; }
          .container { max-width: 1200px; margin: 0 auto; }
          .leaderboard { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          table { width: 100%; border-collapse: collapse; }
          th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
          th { background: #007bff; color: white; cursor: pointer; }
          th:hover { background: #0056b3; }
          .jeet { color: red; }
          .chad { color: green; }
          .neutral { color: #666; }
          button { margin: 10px 0; padding: 10px 20px; background: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer; }
          button:hover { background: #0056b3; }
        </style>
      </head>
      <body>
        <h1>Jeetscan</h1>
        <div class="container">
          <div class="leaderboard">
            <button onclick="toggleSort()">Toggle Sort (Currently Ascending)</button>
            <table id="leaderboardTable">
              <thead>
                <tr>
                  <th>Wallet - Name</th>
                  <th>Avg Hold Time</th>
                  <th>Trade Count</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody id="leaderboardBody">
                ${leaderboard.map(entry => {
                  const quickTradeRatio = entry.tradeCount > 1 ? entry.holdTimes.filter(t => t < 120).length / entry.holdTimes.length : 0;
                  const status = entry.tradeCount <= 1 ? 'Neutral' : quickTradeRatio >= 0.7 ? 'Jeet' : 'Chad';
                  const statusClass = status === 'Jeet' ? 'jeet' : status === 'Chad' ? 'chad' : 'neutral';
                  return `
                    <tr data-holdtime="${entry.avgHoldTime}">
                      <td>${entry.wallet.slice(0, 6)}...${entry.wallet.slice(-4)} - ${walletNames[entry.wallet] || 'Unknown'}</td>
                      <td>${formatTime(entry.avgHoldTime)}</td>
                      <td>${entry.tradeCount}</td>
                      <td><span class="${statusClass}">${status}</span></td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
        <script>
          let ascending = true;
          function toggleSort() {
            ascending = !ascending;
            sortTable();
            document.querySelector('button').textContent = \`Toggle Sort (Currently \${ascending ? 'Ascending' : 'Descending'})\`;
          }

          function sortTable() {
            const tbody = document.getElementById('leaderboardBody');
            const rows = Array.from(tbody.querySelectorAll('tr'));
            rows.sort((a, b) => {
              const aTime = parseFloat(a.getAttribute('data-holdtime'));
              const bTime = parseFloat(b.getAttribute('data-holdtime'));
              return ascending ? aTime - bTime : bTime - aTime;
            });
            rows.forEach(row => tbody.appendChild(row));
          }

          async function updateLeaderboard() {
            const response = await fetch('/leaderboard');
            const data = await response.json();
            const tbody = document.getElementById('leaderboardBody');
            tbody.innerHTML = data.map(entry => {
              const quickTradeRatio = entry.tradeCount > 1 ? entry.holdTimes.filter(t => t < 120).length / entry.holdTimes.length : 0;
              const status = entry.tradeCount <= 1 ? 'Neutral' : quickTradeRatio >= 0.7 ? 'Jeet' : 'Chad';
              const statusClass = status === 'Jeet' ? 'jeet' : status === 'Chad' ? 'chad' : 'neutral';
              return \`
                <tr data-holdtime="\${entry.avgHoldTime}">
                  <td>\${entry.wallet.slice(0, 6)}...\${entry.wallet.slice(-4)} - \${walletNames[entry.wallet] || 'Unknown'}</td>
                  <td>\${formatTime(entry.avgHoldTime)}</td>
                  <td>\${entry.tradeCount}</td>
                  <td><span class="\${statusClass}">\${status}</span></td>
                </tr>
              \`;
            }).join('');
            sortTable();
          }

          function formatTime(seconds) {
            if (seconds < 60) return \`\${seconds.toFixed(2)} s\`;
            return \`\${(seconds / 60).toFixed(2)} min\`;
          }
        </script>
      </body>
      </html>
    `;
    res.send(html);
  } catch (error) {
    console.error('Error generating leaderboard:', error);
    res.status(500).send('Internal Server Error');
  }
});

app.get('/leaderboard', async (req, res) => {
  console.log('Leaderboard endpoint called');
  try {
    const leaderboard = await getLatestLeaderboard();
    res.json(leaderboard);
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/update', async (req, res) => {
  console.log('Update endpoint called');
  try {
    await updateAllWallets();
    res.json({ message: 'Wallets updated' });
  } catch (error) {
    console.error('Error updating wallets:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/reset', async (req, res) => {
  console.log('Reset endpoint called');
  try {
    await connectDB();
    await db.collection('wallet_daily_stats').deleteMany({});
    console.log('Database reset');
    res.json({ message: 'Database reset' });
  } catch (error) {
    console.error('Error resetting database:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Export the app for Vercel
module.exports = app;

// Optional: Local testing
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}