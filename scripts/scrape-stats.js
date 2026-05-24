const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

function normalizePlayerName(name) {
  return name.toLowerCase().replace(/[^a-z]/g, '');
}

async function scrapeWNBAStats() {
  try {
    const url = 'https://www.basketball-reference.com/wnba/years/2026_per_game.html';
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);
    
    const stats = {};
    
    $('table tbody tr').each((i, row) => {
      const cells = $(row).find('td');
      const name = $(cells[1]).text().trim();
      const ppg = parseFloat($(cells[5]).text()) || null;
      const rpg = parseFloat($(cells[7]).text()) || null;
      const apg = parseFloat($(cells[8]).text()) || null;
      const fgp = parseFloat($(cells[9]).text()) || null;
      
      if (name && ppg) {
        stats[normalizePlayerName(name)] = { name, ppg, rpg, apg, fgp };
      }
    });
    
    console.log(`✅ Scraped ${Object.keys(stats).length} players from 2026 season`);
    return stats;
  } catch (error) {
    console.error('❌ Scrape failed:', error.message);
    return null;
  }
}

async function updatePlayersFile(statsMap) {
  if (!statsMap || Object.keys(statsMap).length === 0) {
    console.log('⚠️  No stats found');
    return;
  }
  
  const playersFile = path.join(__dirname, '../src/players.js');
  let content = fs.readFileSync(playersFile, 'utf8');
  
  let matches = 0;
  const playerRegex = /(\{\s*id:\s*\d+,\s*name:\s*"([^"]+)"[^}]*previousTeams:\s*\[[^\]]*\])(?:,\s*stats:\s*\{[^}]*\})?/g;
  
  content = content.replace(playerRegex, (fullMatch, beforeStats, playerName) => {
    const normalized = normalizePlayerName(playerName);
    if (statsMap[normalized]) {
      const stats = statsMap[normalized];
      matches++;
      return `${beforeStats}, stats: { ppg: ${stats.ppg}, rpg: ${stats.rpg}, apg: ${stats.apg}, fgp: ${stats.fgp} }`;
    }
    return fullMatch;
  });
  
  fs.writeFileSync(playersFile, content);
  console.log(`✅ Updated ${matches} players with 2026 season stats`);
}

(async () => {
  const stats = await scrapeWNBAStats();
  await updatePlayersFile(stats);
})();
