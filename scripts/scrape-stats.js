const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

async function scrapeWNBAStats() {
  try {
    // Fetch player stats page
    const url = 'https://www.wnba.com/stats/players/';
    console.log('Fetching from:', url);
    const { data } = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const $ = cheerio.load(data);
    
    const stats = {};
    
    // Find all player rows/cards
    $('tr').each((i, row) => {
      const cells = $(row).find('td');
      if (cells.length < 5) return;
      
      const name = $(cells[0]).text().trim();
      const ppg = parseFloat($(cells[1]).text()) || null;
      const rpg = parseFloat($(cells[2]).text()) || null;
      const apg = parseFloat($(cells[3]).text()) || null;
      const fgp = parseFloat($(cells[4]).text()) || null;
      
      if (name && ppg && name.length > 2) {
        const key = name.toLowerCase().replace(/[^a-z]/g, '');
        stats[key] = { name, ppg, rpg, apg, fgp };
        console.log(`Found: ${name} - ${ppg} PPG`);
      }
    });
    
    console.log(`✅ Total: ${Object.keys(stats).length} players`);
    return stats;
  } catch (error) {
    console.error('Scrape error:', error.message);
    return {};
  }
}

async function updatePlayersFile(statsMap) {
  if (Object.keys(statsMap).length === 0) {
    console.log('No stats found');
    return;
  }
  
  const playersFile = path.join(__dirname, '../src/players.js');
  let content = fs.readFileSync(playersFile, 'utf8');
  let updated = 0;
  
  // Better regex that actually works
  for (const [key, stat] of Object.entries(statsMap)) {
    const escaped = stat.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(
      `(\\{[^}]*name:\\s*"${escaped}"[^}]*previousTeams:\\s*\\[[^\\]]*\\])`
    );
    
    if (pattern.test(content)) {
      content = content.replace(
        pattern,
        `$1, stats: { ppg: ${stat.ppg}, rpg: ${stat.rpg}, apg: ${stat.apg}, fgp: ${stat.fgp} }`
      );
      updated++;
      console.log(`Updated: ${stat.name}`);
    }
  }
  
  fs.writeFileSync(playersFile, content);
  console.log(`✅ Updated ${updated} players in players.js`);
}

(async () => {
  const stats = await scrapeWNBAStats();
  await updatePlayersFile(stats);
})();