const axios = require('axios');
const fs = require('fs');
const path = require('path');

async function scrapeWNBAStats() {
  try {
    // WNBA API endpoint (if available)
    const url = 'https://stats.nba.com/stats/leagueLeaders?StatCategory=PTS&Season=2025-26&SeasonType=Regular%20Season&LeagueID=10';
    console.log('Fetching from NBA API...');
    
    const { data } = await axios.get(url);
    const stats = {};
    
    // Parse NBA API response for WNBA data
    if (data.resultSets && data.resultSets[0]) {
      const rows = data.resultSets[0].rowSet;
      rows.forEach(row => {
        const name = row[1];
        const ppg = parseFloat(row[29]) || 0;
        const rpg = parseFloat(row[20]) || 0;
        const apg = parseFloat(row[21]) || 0;
        const fgp = parseFloat(row[9]) || 0;
        
        if (name && ppg) {
          stats[name.toLowerCase().replace(/[^a-z]/g, '')] = { name, ppg, rpg, apg, fgp };
        }
      });
    }
    
    console.log(`✅ Found ${Object.keys(stats).length} players`);
    return stats;
  } catch (error) {
    console.error('Error:', error.message);
    return {};
  }
}

async function updatePlayersFile(statsMap) {
  const playersFile = path.join(__dirname, '../src/players.js');
  let content = fs.readFileSync(playersFile, 'utf8');
  let updated = 0;
  
  Object.entries(statsMap).forEach(([key, stat]) => {
    const pattern = new RegExp(`name: "${stat.name.replace(/"/g, '\\"')}"([^}]*previousTeams:[^\\]]*\\])`);
    if (pattern.test(content)) {
      content = content.replace(pattern, `name: "${stat.name}"$1, stats: { ppg: ${stat.ppg}, rpg: ${stat.rpg}, apg: ${stat.apg}, fgp: ${stat.fgp} }`);
      updated++;
    }
  });
  
  fs.writeFileSync(playersFile, content);
  console.log(`✅ Updated ${updated} players`);
}

(async () => {
  const stats = await scrapeWNBAStats();
  await updatePlayersFile(stats);
})();