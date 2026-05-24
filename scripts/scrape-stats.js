const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

async function scrapeWNBAStats() {
  try {
    const url = 'https://www.basketball-reference.com/wnba/years/2026_per_game.html';
    console.log('Fetching:', url);
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);
    
    const stats = {};
    let rowCount = 0;
    
    $('table#per_game tbody tr').each((i, row) => {
      rowCount++;
      const cells = $(row).find('td');
      const name = $(cells[1]).text().trim();
      const ppg = parseFloat($(cells[5]).text());
      
      if (name && !isNaN(ppg)) {
        stats[name.toLowerCase().replace(/[^a-z]/g, '')] = {
          name, ppg,
          rpg: parseFloat($(cells[7]).text()) || 0,
          apg: parseFloat($(cells[8]).text()) || 0,
          fgp: parseFloat($(cells[9]).text()) || 0
        };
      }
    });
    
    console.log(`Found ${rowCount} rows, matched ${Object.keys(stats).length} players`);
    return stats;
  } catch (error) {
    console.error('Error:', error.message);
    return {};
  }
}

async function updatePlayersFile(statsMap) {
  try {
    const playersFile = path.join(__dirname, '../src/players.js');
    let content = fs.readFileSync(playersFile, 'utf8');
    let updated = 0;
    
    Object.keys(statsMap).forEach(normalized => {
      const stat = statsMap[normalized];
      const regex = new RegExp(`name: "${stat.name.replace(/"/g, '\\"')}"([^}]*previousTeams:[^\\]]*\\])`, 'i');
      if (content.match(regex)) {
        content = content.replace(regex, `name: "${stat.name}"$1, stats: { ppg: ${stat.ppg}, rpg: ${stat.rpg}, apg: ${stat.apg}, fgp: ${stat.fgp} }`);
        updated++;
      }
    });
    
    fs.writeFileSync(playersFile, content);
    console.log(`Updated ${updated} players`);
  } catch (error) {
    console.error('Update error:', error.message);
  }
}

(async () => {
  const stats = await scrapeWNBAStats();
  await updatePlayersFile(stats);
})();