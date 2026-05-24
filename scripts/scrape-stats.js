const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

async function scrapeWNBAStats() {
  try {
    const url = 'https://www.basketball-reference.com/wnba/years/2025_per_game.html';
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);
    
    const stats = {};
    
    // Parse the stats table
    $('table tbody tr').each((i, row) => {
      const cells = $(row).find('td');
      const name = $(cells[1]).text().trim();
      const ppg = parseFloat($(cells[5]).text()) || null;
      const rpg = parseFloat($(cells[7]).text()) || null;
      const apg = parseFloat($(cells[8]).text()) || null;
      const fgp = parseFloat($(cells[9]).text()) || null;
      
      if (name && ppg) {
        stats[name] = { ppg, rpg, apg, fgp };
      }
    });
    
    console.log(`✅ Scraped ${Object.keys(stats).length} players`);
    return stats;
  } catch (error) {
    console.error('❌ Scrape failed:', error.message);
    return null;
  }
}

async function updatePlayersFile(statsMap) {
  if (!statsMap || Object.keys(statsMap).length === 0) {
    console.log('⚠️  No stats found, skipping update');
    return;
  }
  
  const playersFile = path.join(__dirname, '../src/players.js');
  let content = fs.readFileSync(playersFile, 'utf8');
  
  Object.entries(statsMap).forEach(([name, stats]) => {
    const pattern = new RegExp(
      `(name: "${name.replace(/"/g, '\\"')}"[^}]*previousTeams: \\[[^\\]]*\\])(?:, stats: \\{[^}]*\\})?`
    );
    const replacement = `$1, stats: { ppg: ${stats.ppg}, rpg: ${stats.rpg}, apg: ${stats.apg}, fgp: ${stats.fgp} }`;
    content = content.replace(pattern, replacement);
  });
  
  fs.writeFileSync(playersFile, content);
  console.log('✅ players.js updated');
}

(async () => {
  const stats = await scrapeWNBAStats();
  await updatePlayersFile(stats);
})();