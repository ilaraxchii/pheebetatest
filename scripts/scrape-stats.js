const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

async function scrapeWNBAStats() {
  try {
    const url = 'https://www.wnba.com/stats/';
    console.log('Fetching WNBA stats...');
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);
    
    const stats = {};
    
    // WNBA.com player stats - adjust selectors based on actual HTML
    $('[data-stat-type="player"]').each((i, el) => {
      const name = $(el).find('[data-name]').text().trim();
      const ppg = parseFloat($(el).find('[data-ppg]').text()) || 0;
      const rpg = parseFloat($(el).find('[data-rpg]').text()) || 0;
      const apg = parseFloat($(el).find('[data-apg]').text()) || 0;
      const fgp = parseFloat($(el).find('[data-fgp]').text()) || 0;
      
      if (name && ppg) {
        stats[name.toLowerCase().replace(/[^a-z]/g, '')] = { name, ppg, rpg, apg, fgp };
      }
    });
    
    console.log(`✅ Scraped ${Object.keys(stats).length} players from WNBA.com`);
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
  
  Object.keys(statsMap).forEach(normalized => {
    const stat = statsMap[normalized];
    const regex = new RegExp(`name: "${stat.name.replace(/"/g, '\\"')}"([^}]*previousTeams:[^\\]]*\\])`);
    if (content.match(regex)) {
      content = content.replace(regex, `name: "${stat.name}"$1, stats: { ppg: ${stat.ppg}, rpg: ${stat.rpg}, apg: ${stat.apg}, fgp: ${stat.fgp} }`);
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