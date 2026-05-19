# Adding Stats to Your Players

The quick facts card is now ready to display career stats!

## How to Add Stats to Each Player

Add a `stats` object to each player in your `players.js` file:

```javascript
{
  name: "Angel Reese",
  team: "ATL",
  position: "F",
  height: "6'3\"",
  age: 23,
  number: 10,
  conf: "East",
  previousTeams: ["CHI"],
  stats: {
    ppg: 12.5,    // Points per game
    rpg: 8.2,     // Rebounds per game
    apg: 1.5,     // Assists per game
    fgp: 48.3     // Field goal percentage (without %)
  }
}
```

## Data Sources

- **Official:** stats.wnba.com
- **Basketball-Reference:** basketball-reference.com/wnba/
- **ESPN:** espn.com/wnba/stats
- **Her Hoop Stats:** herhoopstats.com

## Live Updates

For automated scraping:
- Set up a Node.js script that pulls from an API
- Run it daily/weekly to update your players.js
- Deploy with your build pipeline

The card will automatically display "—" for any missing stats!
