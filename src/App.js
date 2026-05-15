// src/App.js
import React, { useState, useEffect, useRef } from 'react';
import players from './players';
import './App.css';
import { supabase } from './supabaseClient'; // keeps the "ready" check
import { loadLeaderboard, upsertStreak } from './streaks';

// paths
const PUB = process.env.PUBLIC_URL;

// "A'ja Wilson" -> "ajawilson"
// "Cheyenne Parker-Tyus" -> "cheyenneparker-tyus"
const slugify = (name) => (name || '').toLowerCase().replace(/[^a-z-]/g, '');

// map team code -> filename (avoid Windows reserved "con")
const teamCodeToFile = (code) => {
  const c = (code || '').toLowerCase();
  if (c === 'con') return 'ctsun';
  return c;
};

// ================= rotation & storage =================
const DEBUG =
  new URLSearchParams(window.location.search).get('debug') === '1' ||
  localStorage.getItem('phee:debug') === '1';

function getCTParts(d = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map(p => [p.type, p.value]));
  return parts;
}
const ctDateStr = (d = new Date()) => {
  const p = getCTParts(d);
  return `${p.year}-${p.month}-${p.day}`;
};
const yesterdayCt = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const p = getCTParts(d);
  return `${p.year}-${p.month}-${p.day}`;
};

function getRotationKey() {
  const p = getCTParts();
  if (DEBUG) return `CT-${p.year}-${p.month}-${p.day}-${p.hour}-${p.minute}`;
  return `CT-${p.year}-${p.month}-${p.day}`;
}

// rng helpers
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function() {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}
function mulberry32(a) {
  return function() {
    let t = (a += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const playersStable = [...players].sort((a, b) => (a.id ?? 0) - (b.id ?? 0));

const STORAGE_PREFIX = 'phee:v1';
const gameKeyFor = (rotationKey) => `${STORAGE_PREFIX}:game:${rotationKey}`;
const solutionKeyFor = (rotationKey) => `${STORAGE_PREFIX}:solution:${rotationKey}`;
const lockKeyFor = (rotationKey) => `${STORAGE_PREFIX}:locked:${rotationKey}`;
const isLocked = (rotationKey) => localStorage.getItem(lockKeyFor(rotationKey)) === '1';

function pickSolutionFor(rotationKey) {
  const seed = xmur3(rotationKey)();
  const rand = mulberry32(seed);
  const idx = Math.floor(rand() * playersStable.length);
  return playersStable[idx];
}

// ================= Device ID binding (anti-hijack) =================
function getDeviceId() {
  let id = localStorage.getItem('phee:device_id');
  if (id) return id;
  try {
    const buf = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(buf);
    id = [...buf].map(b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    id = String(Math.random()).slice(2) + String(Date.now());
  }
  localStorage.setItem('phee:device_id', id);
  return id;
}
const DEVICE_ID = getDeviceId();

// ================= brand =================
const BIRD_HEAD = `${PUB}/branding/sue-bird-head.png`;

function Brand() {
  return (
    <div className="brand">
      <img src={BIRD_HEAD} alt="Sue Bird" className="brand-head" />
      <div className="brand-word">
        <span className="brand-text">bird</span>
        <span className="brand-dash">-</span>
        <span className="brand-le">le</span>
      </div>
    </div>
  );
}

// team list for picker (adjust to your available logo files)
const TEAM_CODES = ['ATL','CHI','CON','DAL','IND','LVA','MIN','NYL','PHX','SEA','WAS'];

// keep @handles tidy & short (no '@' allowed in the field)
const normalizeHandle = (h = '') =>
  h.trim()
   .replace(/^@+/, '')       // strip leading @s
   .replace(/\s+/g, '')      // no spaces
   .replace(/[^\w.-]/g, '')  // only letters/numbers/_ . -
   .slice(0, 20);            // max 20 chars

// ======== badges (client-first; optional Supabase sync) ========
const BADGE_DEFS = {
  streak5:  { label: '5-Streak',     emoji: '🔥' },
  streak10: { label: '10-Streak',    emoji: '💥' },
  perfect:  { label: 'Perfect Game', emoji: '🎯' },
  under30:  { label: 'Under 30s',    emoji: '⏱️' },
};
const loadBadgesLS = () => {
  try { return JSON.parse(localStorage.getItem('phee:badges') || '[]'); } catch { return []; }
};
const saveBadgesLS = (arr) => {
  try { localStorage.setItem('phee:badges', JSON.stringify([...new Set(arr)])); } catch {}
};

// ======== plays history (for heatmap) ========
const loadPlaysLS = () => {
  try { return JSON.parse(localStorage.getItem('phee:plays') || '[]'); } catch { return []; }
};
const savePlaysLS = (arr) => {
  try { localStorage.setItem('phee:plays', JSON.stringify([...new Set(arr)])); } catch {}
};

// --- small heatmap component (with 🔥 icon for played days) ---
function StreakCalendar({ plays = [] }) {
  // last 42 days, ending today (Chicago time)
  const days = [];
  for (let i = 41; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(ctDateStr(d));
  }
  const playedSet = new Set(plays);
  return (
    <div style={{display:'flex', flexDirection:'column', alignItems:'center', gap:8}}>
      <div style={{
        display:'grid',
        gridTemplateColumns:'repeat(7, 16px)',
        gridAutoRows:'16px',
        gap:'4px',
        padding:'6px 8px',
        background:'#fff',
        border:'1px solid #eee',
        borderRadius:8,
      }}>
        {days.map((ymd) => {
          const on = playedSet.has(ymd);
          const isToday = ymd === ctDateStr();
          return (
            <div
              key={ymd}
              title={`${ymd}${on ? ' — played' : ''}${isToday ? ' (today)' : ''}`}
              style={{
                width:16, height:16, borderRadius:3,
                background: on ? '#fff7e6' : '#e9e9e9',
                outline: isToday ? '2px solid #FF5910' : 'none',
                display:'flex', alignItems:'center', justifyContent:'center',
                fontSize:12
              }}
            >
              {on ? '🔥️' : ''}
            </div>
          );
        })}
      </div>
      <div style={{fontSize:12, color:'#666'}}>Last 6 weeks</div>
    </div>
  );
}

// ================= app =================
function App() {
  const [playerName, setPlayerName] = useState('');
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [message, setMessage] = useState('');
  const [guessesLeft, setGuessesLeft] = useState(8);
  const [previousGuesses, setPreviousGuesses] = useState(Array(8).fill(null));
  const [timer, setTimer] = useState(0); // count-up
  const [showSilhouette, setShowSilhouette] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [triesTaken, setTriesTaken] = useState(0);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [guessedPlayers, setGuessedPlayers] = useState([]);
  const [showHelp, setShowHelp] = useState(false);
  const [showActualPortrait, setShowActualPortrait] = useState(false);
  const [showPortraitModal, setShowPortraitModal] = useState(false);
  const [portraitModalDismissed, setPortraitModalDismissed] = useState(false);
  const intervalRef = useRef(null);

  // 🔥 Streak/leaderboard + team/logo + tabs + my badges/plays
  const [showStreak, setShowStreak] = useState(false);
  const [streakTab, setStreakTab] = useState('leaderboard'); // 'leaderboard' | 'mystats'
  const [handle, setHandle] = useState(localStorage.getItem('phee:handle') || '');
  const [teamChoice, setTeamChoice] = useState(localStorage.getItem('phee:team') || '');
  const [currentStreak, setCurrentStreak] = useState(parseInt(localStorage.getItem('phee:streak') || '0', 10));
  const [bestStreak, setBestStreak] = useState(parseInt(localStorage.getItem('phee:beststreak') || '0', 10));
  const [leaderboard, setLeaderboard] = useState([]);
  const [lbLoading, setLbLoading] = useState(false);
  const [lbError, setLbError] = useState('');
  const [, setMyBadges] = useState(loadBadgesLS()); // we only need the setter now
  const [plays, setPlays] = useState(loadPlaysLS());

  const supaReady = !!supabase;

  // ⏪ Archive Day
  const [showArchive, setShowArchive] = useState(false);
  const [archiveDate, setArchiveDate] = useState(ctDateStr());
  const [archiveMode, setArchiveMode] = useState(false);

  const [rotationKey, setRotationKey] = useState(getRotationKey());

  // auto-advance rotation key (but NOT in archive mode)
  useEffect(() => {
    if (archiveMode) return;
    const tick = setInterval(() => {
      const nextKey = getRotationKey();
      setRotationKey((prev) => (prev === nextKey ? prev : nextKey));
    }, DEBUG ? 5_000 : 60_000);
    return () => clearInterval(tick);
  }, [archiveMode]);

  // load/hydrate
  useEffect(() => {
    if (!rotationKey) return;

    const solKey = solutionKeyFor(rotationKey);
    let storedSolution = null;
    try {
      const rawSol = localStorage.getItem(solKey);
      storedSolution = rawSol ? JSON.parse(rawSol) : null;
    } catch {}
    if (!storedSolution) {
      storedSolution = pickSolutionFor(rotationKey);
      try { localStorage.setItem(solKey, JSON.stringify(storedSolution)); } catch {}
    }
    setSelectedPlayer(storedSolution);

    const gKey = gameKeyFor(rotationKey);
    const locked = isLocked(rotationKey);

    try {
      const raw = localStorage.getItem(gKey);
      if (raw && !archiveMode) {
        const s = JSON.parse(raw);
        if (typeof s.guessesLeft === 'number') setGuessesLeft(s.guessesLeft);
        if (Array.isArray(s.previousGuesses)) setPreviousGuesses(s.previousGuesses);
        if (typeof s.gameOver === 'boolean') setGameOver(s.gameOver || locked);
        if (typeof s.message === 'string') setMessage(s.message);
        if (typeof s.triesTaken === 'number') setTriesTaken(s.triesTaken);
        if (Array.isArray(s.guessedPlayers)) setGuessedPlayers(s.guessedPlayers);

        const savedAt = s.timerSavedAt ?? Date.now();
        const delta = Math.floor((Date.now() - savedAt) / 1000);
        const base = typeof s.timer === 'number' ? s.timer : 0;
        const t = (s.gameOver || locked) ? base : base + delta;
        setTimer(t);

        if (locked || s.gameOver) {
          setShowActualPortrait(true);
          setShowPortraitModal(false);
          setPortraitModalDismissed(true);
        }
      } else {
        // fresh state; archive mode ignores lock
        if (locked && !archiveMode) {
          setGameOver(true);
          setShowActualPortrait(true);
          setShowPortraitModal(false);
          setPortraitModalDismissed(true);
          setMessage('✅ Already completed for today.');
        } else {
          resetGameState(true);
        }
      }
    } catch {
      resetGameState(true);
    }

    startTimer();

    Object.keys(localStorage)
      .filter(k => k.startsWith(`${STORAGE_PREFIX}:game:`) && k !== gKey)
      .forEach(k => localStorage.removeItem(k));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rotationKey, archiveMode]);

  // persist
  useEffect(() => {
    if (!rotationKey) return;
    const gKey = gameKeyFor(rotationKey);
    const gameState = {
      guessesLeft,
      previousGuesses,
      gameOver,
      message,
      triesTaken,
      guessedPlayers,
      timer,
      timerSavedAt: Date.now(),
      version: 3,
      savedAt: Date.now(),
      archiveMode,
    };
    try { localStorage.setItem(gKey, JSON.stringify(gameState)); } catch {}
  }, [
    rotationKey, guessesLeft, previousGuesses, gameOver,
    message, triesTaken, guessedPlayers, timer, archiveMode
  ]);

  const resetGameState = (force = false) => {
    if (!archiveMode && isLocked(rotationKey) && !DEBUG && !force) return;
    setGuessesLeft(8);
    setPreviousGuesses(Array(8).fill(null));
    setGameOver(false);
    setMessage('');
    setTriesTaken(0);
    setGuessedPlayers([]);
    setShowSilhouette(false);
    setShowActualPortrait(false);
    setShowPortraitModal(false);
    setPortraitModalDismissed(false);
    setTimer(0);
    startTimer();
  };

  // Name formatting
  const capitalizeName = (name) => {
    return name.split(' ').map(part => {
      return part.split('-').map(subPart => {
        if (subPart.toLowerCase().startsWith('mc')) {
          return 'Mc' + subPart.charAt(2).toUpperCase() + subPart.slice(3).toLowerCase();
        }
        return subPart.charAt(0).toUpperCase() + subPart.slice(1).toLowerCase();
      }).join('-');
    }).join(' ');
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!selectedPlayer || guessesLeft <= 0 || gameOver) return;

    const correctedPlayerName = capitalizeName(playerName);
    if (guessedPlayers.includes(correctedPlayerName)) {
      setMessage("❌ You've already guessed this player! Try a different name.");
      setPlayerName('');
      return;
    }

    const foundPlayer = players.find(p => p.name.toLowerCase().trim() === correctedPlayerName.toLowerCase().trim());
    setTriesTaken(prev => prev + 1);

    if (foundPlayer) {
      const guessFeedback = getGuessFeedback(foundPlayer);
      const updatedGuesses = [...previousGuesses];
      const emptyIndex = updatedGuesses.findIndex(guess => guess === null);
      if (emptyIndex !== -1) {
        updatedGuesses[emptyIndex] = { guess: correctedPlayerName, feedback: guessFeedback };
      }
      setPreviousGuesses(updatedGuesses);

      if (foundPlayer.id === selectedPlayer.id) {
        setShowSilhouette(true);
        const nextTries = triesTaken + 1; // state update is async; compute local
        handleGameEnd(`🎉 Correct! The player was ${selectedPlayer.name}!`, true, nextTries);
      } else {
        setGuessedPlayers(prev => [...prev, correctedPlayerName]);
        setGuessesLeft(prev => prev > 0 ? prev - 1 : 0);
        setMessage("❌ Incorrect! Try again.");
        if (guessesLeft <= 1) {
          handleGameEnd(`Game Over! The correct player was ${selectedPlayer.name}.`, false);
        }
      }
    } else {
      setMessage("❌ Player not found! Make sure you're guessing the correct name.");
      if (guessesLeft <= 1) {
        handleGameEnd(`Game Over! The correct player was ${selectedPlayer.name}.`, false);
      }
    }

    setPlayerName('');
    setShowSuggestions(false);
  };

  const getGuessFeedback = (guessedPlayer) => {
    let feedback = {};

    // team
    feedback.team = guessedPlayer.team === selectedPlayer.team
      ? `${guessedPlayer.team} ✅`
      : selectedPlayer.previousTeams?.includes(guessedPlayer.team)
        ? `${guessedPlayer.team} 🟡`
        : `${guessedPlayer.team} ❌`;

    // pos
    const guessedPositionParts = guessedPlayer.position.split('-');
    const selectedPositionParts = selectedPlayer.position.split('-');
    const positionMatch = guessedPositionParts.some(pos => selectedPositionParts.includes(pos));

    feedback.position = guessedPlayer.position === selectedPlayer.position
      ? '✅'
      : positionMatch
        ? '🟡'
        : '❌';

    feedback.positionText = guessedPlayer.position;

    // conf
    feedback.confText = `${guessedPlayer.conf} ${guessedPlayer.conf === selectedPlayer.conf ? '✅' : '❌'}`;
    feedback.conf = guessedPlayer.conf === selectedPlayer.conf ? '✅' : '❌';

    // height
    const parseHeight = (height) => {
      const [feet, inches] = height.split("'").map((part) => parseInt(part.trim(), 10));
      return (feet * 12) + inches;
    };
    const guessedHeightInches = parseHeight(guessedPlayer.height);
    const selectedHeightInches = parseHeight(selectedPlayer.height);
    const heightDiff = Math.abs(guessedHeightInches - selectedHeightInches);

    feedback.height = {
      value: guessedHeightInches === selectedHeightInches ? guessedPlayer.height : `${guessedPlayer.height}`,
      emoji: guessedHeightInches === selectedHeightInches
        ? '✅'
        : heightDiff <= 2
          ? '🟡'
          : guessedHeightInches < selectedHeightInches
            ? '⬆️'
            : '⬇️',
      className: guessedHeightInches === selectedHeightInches
        ? ''
        : heightDiff <= 2
          ? 'yellow'
          : guessedHeightInches < selectedHeightInches
            ? 'arrow-up'
            : 'arrow-down',
    };

    // age
    const ageDiff = Math.abs(guessedPlayer.age - selectedPlayer.age);
    feedback.age = {
      value: guessedPlayer.age === selectedPlayer.age ? guessedPlayer.age : `${guessedPlayer.age}`,
      emoji: guessedPlayer.age === selectedPlayer.age
        ? '✅'
        : ageDiff <= 2
          ? '🟡'
          : guessedPlayer.age < selectedPlayer.age
            ? '⬆️'
            : '⬇️',
      className: guessedPlayer.age === selectedPlayer.age
        ? ''
        : ageDiff <= 2
          ? 'yellow'
          : guessedPlayer.age < selectedPlayer.age
            ? 'arrow-up'
            : 'arrow-down',
    };

    // number
    const guessedNumber = parseInt(guessedPlayer.number, 10);
    const selectedNumber = parseInt(selectedPlayer.number, 10);
    const numberDiff = Math.abs(guessedNumber - selectedNumber);

    feedback.numberMatch = {
      value: guessedNumber === selectedNumber ? guessedNumber : `${guessedNumber}`,
      emoji: guessedNumber === selectedNumber
        ? '✅'
        : numberDiff <= 2
          ? '🟡'
          : guessedNumber < selectedNumber
            ? '⬆️'
            : '⬇️',
      className: guessedNumber === selectedNumber
        ? ''
        : numberDiff <= 2
          ? 'yellow'
          : guessedNumber < selectedPlayer.number
            ? 'arrow-up'
            : 'arrow-down',
    };

    return feedback;
  };

  const startTimer = () => {
    clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      setTimer(prev => prev + 1);
    }, 1000);
  };

  const handlePlayAgain = () => {
    if (!DEBUG) return;
    try { localStorage.removeItem(lockKeyFor(rotationKey)); } catch {}
    resetGameState(true);
  };

  const handlePlayerNameChange = (e) => {
    setPlayerName(e.target.value);
    setShowSuggestions(true);
  };

  const handleSuggestionClick = (suggestion) => {
    setPlayerName(suggestion);
    setShowSuggestions(false);
  };

  // ✅ update streaks + sync to Supabase on game end (uses helper/upsert)
  const updateStreakAndSync = async (won, meta = {}) => {
    if (!won) {
      return;
    }

    const today = ctDateStr();
    const last = localStorage.getItem('phee:lastPlay') || '';
    const yday = yesterdayCt();

    let newStreak = currentStreak;
    if (last === today) {
      // already counted today
    } else if (last === yday) {
      newStreak = currentStreak + 1;
    } else {
      newStreak = 1;
    }

    const newBest = Math.max(bestStreak, newStreak);

    // record plays (for heatmap)
    const playsNow = loadPlaysLS();
    if (!playsNow.includes(today)) {
      playsNow.push(today);
      if (playsNow.length > 365) playsNow.splice(0, playsNow.length - 365);
      savePlaysLS(playsNow);
      setPlays(playsNow);
    }

    // award badges (kept for leaderboard-only flair)
    const triesUsed = Number.isFinite(meta.triesUsed) ? meta.triesUsed : triesTaken;
    const timeSecs  = Number.isFinite(meta.timeSecs)  ? meta.timeSecs  : timer;
    const newly = [];
    if (triesUsed === 1) newly.push('perfect');
    if (timeSecs <= 30) newly.push('under30');
    if (newStreak >= 5) newly.push('streak5');
    if (newStreak >= 10) newly.push('streak10');

    const have = loadBadgesLS();
    const afterBadges = Array.from(new Set([...have, ...newly]));
    saveBadgesLS(afterBadges);
    setMyBadges(afterBadges);

    // update local streaks
    setCurrentStreak(newStreak);
    setBestStreak(newBest);
    localStorage.setItem('phee:streak', String(newStreak));
    localStorage.setItem('phee:beststreak', String(newBest));
    localStorage.setItem('phee:lastPlay', today);

    // push to DB if env + handle exist
    const clean = normalizeHandle(handle);
    if (supaReady && clean) {
      try {
        if (typeof upsertStreak === 'function') {
          await upsertStreak({
            handle: clean,
            currentStreak: newStreak,
            bestStreak: newBest,
            rotationKey,
            deviceId: DEVICE_ID,
            team: teamChoice || null,
          });
        } else {
          await supabase
            .from('profiles')
            .upsert({
              handle: clean,
              current_streak: newStreak,
              best_streak: newBest,
              device_id: DEVICE_ID,
              team: teamChoice || null,
              last_played: today
            }, { onConflict: 'handle,device_id' });
        }
      } catch (e) {
        console.warn('Supabase upsert failed:', e);
      }

      // optional: try to sync badges if a `badges` column exists (ignore errors if not)
      try {
        await supabase
          .from('profiles')
          .update({ badges: afterBadges })
          .eq('handle', clean)
          .eq('device_id', DEVICE_ID);
      } catch (e) {
        // ignore if column doesn't exist / RLS blocks
      }
    }
  };

  const handleGameEnd = (msg, won, triesUsedMaybe) => {
    clearInterval(intervalRef.current);
    setMessage(msg);
    setGameOver(true);
    setShowActualPortrait(true);

    if (!archiveMode) {
      try { localStorage.setItem(lockKeyFor(rotationKey), '1'); } catch {}
      setShowPortraitModal(true);
      setPortraitModalDismissed(false);
      updateStreakAndSync(!!won, { triesUsed: triesUsedMaybe, timeSecs: timer });
    } else {
      setShowPortraitModal(true);
      setPortraitModalDismissed(false);
    }
  };

  // Leaderboard fetch (uses helper/loadLeaderboard)
  const openStreakModal = async () => {
    setShowStreak(true);
    setStreakTab('leaderboard');
    if (!supaReady) return;
    setLbLoading(true);
    setLbError('');
    try {
      const { data, error } = await loadLeaderboard();
      if (error) throw error;
      setLeaderboard(data || []);
    } catch (e) {
      setLbError('Could not load leaderboard.');
    } finally {
      setLbLoading(false);
    }
  };

  const saveHandle = async () => {
    const clean = normalizeHandle(handle);
    if (!clean) {
      setLbError('Pick a handle first.');
      return;
    }

    setHandle(clean);
    localStorage.setItem('phee:handle', clean);
    localStorage.setItem('phee:team', teamChoice || '');

    if (!supaReady) {
      setLbError('Leaderboard backend is offline. Saved locally.');
      return;
    }

    const { error } = await upsertStreak({
      handle: clean,
      currentStreak,
      bestStreak,
      rotationKey,
      deviceId: DEVICE_ID,
      team: teamChoice || null,
    });

    if (error) {
      const msg =
        /HANDLE_TAKEN/i.test(error.message || '') ||
        /HANDLE_TAKEN/i.test(error.details || '') ||
        /unique/i.test(error.message || '')
          ? '❌ That @ is already claimed on another device.'
          : `❌ Save failed: ${error.message || 'unknown error'}`;
      setLbError(msg);
      return;
    }

    try {
      await supabase
        .from('profiles')
        .update({ badges: loadBadgesLS() })
        .eq('handle', clean)
        .eq('device_id', DEVICE_ID);
    } catch {}

    setLbError('');
    const { data, error: lbErr } = await loadLeaderboard();
    if (lbErr) {
      setLbError('Could not load leaderboard.');
    } else {
      setLeaderboard(data || []);
    }
  };

  // Archive actions
  const goArchive = () => {
    const key = `CT-${archiveDate}`;
    setArchiveMode(true);
    setRotationKey(key);
    resetGameState(true);
    setShowArchive(false);
  };
  const backToToday = () => {
    setArchiveMode(false);
    setRotationKey(getRotationKey());
    resetGameState(true);
  };

  const getEmoji = (feedback, type) => {
    if (type === 'team' || type === 'position' || type === 'conf') {
      if (feedback.includes('✅')) return '🟩';
      if (feedback.includes('🟡')) return '🟨';
      return '⬛';
    }
    if (type === 'height' || type === 'age' || type === 'number') {
      if (feedback.emoji === '✅') return '🟩';
      if (feedback.emoji === '⬆️' || feedback.emoji === '⬇️') return '🟨';
      return '⬛';
    }
    return '⬛';
  };

  const formatShareText = () => {
    const gameNumber = rotationKey;
    const guessesUsed = triesTaken;
    const maxGuesses = previousGuesses.length;
    const win = gameOver && message.includes('Correct!');
    const guessCount = win ? guessesUsed : 'X';

    let result = `PHEE ${gameNumber} ${guessCount}/${maxGuesses}${archiveMode ? ' (ARCHIVE)' : ''}\n\n`;

    previousGuesses.forEach((guess) => {
      if (guess) {
        result += [
          getEmoji(guess.feedback.team, 'team'),
          getEmoji(guess.feedback.position, 'position'),
          getEmoji(guess.feedback.conf, 'conf'),
          getEmoji(guess.feedback.height, 'height'),
          getEmoji(guess.feedback.age, 'age'),
          getEmoji(guess.feedback.numberMatch, 'number')
        ].join('') + '\n';
      }
    });

    return result.trim();
  };

  const handleShare = async () => {
    const shareText = formatShareText();
    try {
      await navigator.clipboard.writeText(shareText);
      setMessage('✅ Result copied to clipboard!');
      setShowActualPortrait(true);
    } catch (err) {
      setMessage('❌ Could not copy to clipboard.');
    }
  };

  useEffect(() => {
    clearInterval(intervalRef.current);
    if (!selectedPlayer || gameOver) return;

    intervalRef.current = setInterval(() => {
      setTimer(prev => prev + 1);
    }, 1000);

    return () => clearInterval(intervalRef.current);
  }, [selectedPlayer, gameOver]);

  useEffect(() => {
    if (gameOver) clearInterval(intervalRef.current);
  }, [gameOver]);

  // ====== small UI helpers ======
  const TabBtn = ({ active, onClick, children }) => (
    <button
      onClick={onClick}
      className="ia-btn"
      style={{
        background: active ? '#FFD700' : '#fff',
        border: active ? 'none' : '2px solid #000',
        boxShadow: active ? '0 2px 8px rgba(0,0,0,.12)' : '0 2px 8px rgba(0,0,0,.08)',
        borderRadius: 10,
        padding: '8px 12px',
        margin: 0
      }}
    >
      {children}
    </button>
  );

  const BadgeDot = ({ id }) => {
    const def = BADGE_DEFS[id] || { emoji: '🏅', label: id };
    return (
      <span
        title={def.label}
        style={{
          display:'inline-flex', alignItems:'center', justifyContent:'center',
          width:18, height:18, borderRadius:9, background:'#fff',
          border:'1.5px solid #000', marginRight:6, fontSize:12, lineHeight:'18px'
        }}
        aria-label={def.label}
      >
        {def.emoji}
      </span>
    );
  };

  return (
    <div className="App">
      <div className="fade-in-main">
        {/* Archive banner */}
        {archiveMode && (
          <div className="archive-banner">
            <span>⏪ Archive Day: {rotationKey.replace(/^CT-/, '')} — no streaks/locks</span>
            <button className="archive-exit" onClick={backToToday}>Back to Today</button>
          </div>
        )}

        {/* help */}
        <div
          className="help-icon"
          onClick={() => setShowHelp(true)}
          title="How to play"
        >
          ?
        </div>

        {showHelp && (
          <div className="help-modal-overlay" onClick={() => setShowHelp(false)}>
            <div className="help-modal" onClick={e => e.stopPropagation()}>
              <button
                className="help-modal-close"
                onClick={() => setShowHelp(false)}
                aria-label="Close"
              >×</button>
              <h2>How to Play</h2>
              <ul>
                <li><b>Guess</b>: Enter the full name of a player and click Guess.</li>
                <li><b>Show/Hide Silhouette</b>: Toggle the silhouette/headshot.</li>
              </ul>
              <p><b>Note:</b> Not all players have a jumpshot clip yet.</p>
            </div>
          </div>
        )}

        {/* brand */}
        <Brand />

        {/* guesses left – segmented */}
        <div
          className={`guesses-meter ${guessesLeft <= 2 ? 'danger' : ''}`}
          role="progressbar"
          aria-valuenow={guessesLeft}
          aria-valuemin={0}
          aria-valuemax={8}
        >
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className={`gm-seg ${i < guessesLeft ? 'on' : 'off'} ${i === guessesLeft - 1 && guessesLeft > 0 ? 'last' : ''}`}
            />
          ))}
          <div className="gm-label">{guessesLeft}</div>
        </div>

        {/* timer */}
        <div className="clock-wrap">
          <ShotClock seconds={timer} />
        </div>

        {!gameOver && guessesLeft > 0 ? (
          <form onSubmit={handleSubmit}>
            <div className="search-container">
              <input
                type="text"
                placeholder="Enter full player name"
                value={playerName}
                onChange={handlePlayerNameChange}
                disabled={gameOver || guessesLeft <= 0}
                className={gameOver || guessesLeft <= 0 ? 'disabled-input' : ''}
              />
              {playerName && (
                <div className={`suggestions${showSuggestions ? ' open' : ''}`}>
                  {showSuggestions && (() => {
                    const input = playerName.toLowerCase();
                    const startsWith = [];
                    const contains = [];
                    players.forEach(player => {
                      const name = player.name.toLowerCase();
                      if (!guessedPlayers.includes(player.name) && name.includes(input)) {
                        if (name.startsWith(input)) {
                          startsWith.push(player);
                        } else {
                          contains.push(player);
                        }
                      }
                    });
                    const suggestions = [...startsWith, ...contains];
                    return suggestions.slice(0, 2).map((suggestion, idx) => (
                      <div
                        className="suggestion"
                        key={idx}
                        onClick={() => handleSuggestionClick(suggestion.name)}
                      >
                        {suggestion.name}
                      </div>
                    ));
                  })()}
                </div>
              )}
            </div>
            <button type="submit" disabled={gameOver || guessesLeft <= 0}>Guess</button>
          </form>
        ) : (
          <div>
            {gameOver && (
              <div className="game-over-simple">
                <p className="game-over-message">{message || `The correct player was ${selectedPlayer?.name}.`}</p>
                <div className="game-over-buttons">
                  {DEBUG ? (
                    <button onClick={handlePlayAgain}>Play Again (debug)</button>
                  ) : (
                    <button disabled title="Come back after midnight CT for a new player">Play Again</button>
                  )}
                  <button onClick={handleShare} style={{ marginLeft: 8 }}>Share Result</button>
                </div>
              </div>
            )}
          </div>
        )}

        <button
          onClick={() => setShowSilhouette(prev => !prev)}
          disabled={gameOver || guessesLeft <= 0}
          className={gameOver || guessesLeft <= 0 ? 'disabled-button' : 'silhouette-button'}
        >
          {showSilhouette ? 'Hide Silhouette' : 'Show Silhouette'}
        </button>

        {selectedPlayer && (
          <div className="silhouette-container">
            {showSilhouette && !showActualPortrait && (
              <img
                src={`${PUB}/images/${slugify(selectedPlayer.name)}-headshot.png`}
                alt="Player silhouette"
                className="silhouette"
              />
            )}
            {gameOver && portraitModalDismissed && (
              <img
                src={`${PUB}/images/${slugify(selectedPlayer.name)}-actual.png`}
                alt="Player actual"
                className="actual"
              />
            )}
          </div>
        )}

        {/* portrait pop (after result) */}
        {showPortraitModal && selectedPlayer && (
          <div className="help-modal-overlay" onClick={() => {
            setShowPortraitModal(false);
            setPortraitModalDismissed(true);
          }}>
            <div className="help-modal" onClick={e => e.stopPropagation()} style={{textAlign: 'center'}}>
              <button
                className="help-modal-close"
                onClick={() => {
                  setShowPortraitModal(false);
                  setPortraitModalDismissed(true);
                }}
                aria-label="Close"
              >×</button>
              <h2>Player Revealed</h2>
              <img
                src={`${PUB}/images/${slugify(selectedPlayer.name)}-actual.png`}
                alt={selectedPlayer.name}
                className="actual"
                style={{maxWidth: '100%', height: 'auto', margin: '16px 0'}}
              />
              <div style={{fontWeight: 500, fontSize: 18}}>{selectedPlayer?.name}</div>
            </div>
          </div>
        )}

        {/* === Previous Guesses table === */}
        <div className="game-info">
          <h3>Previous Guesses:</h3>
          <div className="info-box">
            <div className="info-box-inner">
              {/* Desktop header */}
              <div className="info-item-wrapper title">
                <div className="info-label">Name</div>
                <div className="info-label">Team</div>
                <div className="info-label">Pos</div>
                <div className="info-label">Conf</div>
                <div className="info-label">Ht</div>
                <div className="info-label">Age</div>
                <div className="info-label">#</div>
              </div>

              {/* Mobile header */}
              <div className="mobile-grid-head" aria-hidden="true">
                <div>Team</div><div>Pos</div><div>Conf</div><div>Ht</div><div>Age</div><div>#</div>
              </div>

              {previousGuesses.map((prevGuess, index) => (
                <div
                  key={index}
                  className={`info-item-wrapper guess${
                    prevGuess && prevGuess.guess === selectedPlayer?.name
                      ? ' correct-row'
                      : prevGuess && prevGuess.guess
                        ? ' accent-row'
                        : ''
                  }`}
                >
                  <div className="info-item name-cell">
                    {prevGuess ? prevGuess.guess : ''}
                  </div>

                  <div className={`info-item ${prevGuess ? getFeedbackClassTeam(prevGuess.feedback.team) : ''} team-cell`}>
                    {prevGuess && (
                      <div style={{display:'flex',flexDirection:'column',alignItems:'center',width:'100%'}}>
                        {(() => {
                          const code = prevGuess?.feedback?.team
                            ? prevGuess.feedback.team.split(' ')[0]
                            : '';
                          const file = teamCodeToFile(code);
                          return (
                            <img
                              src={`${PUB}/logos/${file}.png`}
                              alt={code}
                              style={{height:24, marginBottom:2, objectFit:'contain'}}
                            />
                          );
                        })()}
                        <span style={{fontSize:'1em', marginTop:2}}>
                          {prevGuess?.feedback?.team ? prevGuess.feedback.team.split(' ')[0] : ''}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className={`info-item ${prevGuess ? getFeedbackClassSimple(prevGuess.feedback.position) : ''} pos-cell`}>
                    {prevGuess ? prevGuess.feedback.positionText : ''}
                  </div>

                  <div className={`info-item ${prevGuess ? getFeedbackClassSimple(prevGuess.feedback.conf) : ''} conf-cell`}>
                    {prevGuess ? (prevGuess.feedback.confText ? prevGuess.feedback.confText.split(' ')[0] : '') : ''}
                  </div>

                  <div className={`info-item ht-cell ${prevGuess ? getFeedbackClass(prevGuess.feedback.height) : ''}`}>
                    {prevGuess ? prevGuess.feedback.height.value : ''}
                    {prevGuess && (prevGuess.feedback.height.emoji === '⬆️' || prevGuess.feedback.height.emoji === '⬇️') && (
                      <span className={prevGuess.feedback.height.emoji === '⬆️' ? 'arrow-up' : 'arrow-down'}>
                        {prevGuess.feedback.height.emoji}
                      </span>
                    )}
                  </div>

                  <div className={`info-item age-cell ${prevGuess ? getFeedbackClass(prevGuess.feedback.age) : ''}`}>
                    {prevGuess ? prevGuess.feedback.age.value : ''}
                    {prevGuess && (prevGuess.feedback.age.emoji === '⬆️' || prevGuess.feedback.age.emoji === '⬇️') && (
                      <span className={prevGuess.feedback.age.emoji === '⬆️' ? 'arrow-up' : 'arrow-down'}>
                        {prevGuess.feedback.age.emoji}
                      </span>
                    )}
                  </div>

                  <div className={`info-item num-cell ${prevGuess ? getFeedbackClass(prevGuess.feedback.numberMatch) : ''}`}>
                    {prevGuess ? prevGuess.feedback.numberMatch.value : ''}
                    {prevGuess && (prevGuess.feedback.numberMatch.emoji === '⬆️' || prevGuess.feedback.numberMatch.emoji === '⬇️') && (
                      <span className={prevGuess.feedback.numberMatch.emoji === '⬆️' ? 'arrow-up' : 'arrow-down'}>
                        {prevGuess.feedback.numberMatch.emoji}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        {/* === /Previous Guesses === */}
      </div>

      {/* 🔥 Floating streak button */}
      <button
        className="streak-fab"
        title="Streaks & Leaderboard"
        onClick={openStreakModal}
      >
        🔥
      </button>

      {/* ⏪ Archive Day FAB (stacked under fire) */}
      <button
        className="archive-fab"
        title="Archive Day"
        onClick={() => setShowArchive(true)}
        aria-label="Archive Day"
      >
        ⏪
      </button>

      {/* 🔥 Streaks/Leaderboard modal */}
      {showStreak && (
        <div className="streak-modal-overlay" onClick={() => setShowStreak(false)}>
          <div className="streak-modal" onClick={(e) => e.stopPropagation()}>
            <button className="streak-close" onClick={() => setShowStreak(false)} aria-label="Close">×</button>

            <h2 className="streak-title">Streaks</h2>

            {/* tabs */}
            <div className="inline-actions" style={{marginTop:6, marginBottom:12}}>
              <TabBtn active={streakTab === 'leaderboard'} onClick={() => setStreakTab('leaderboard')}>Leaderboard</TabBtn>
              <TabBtn active={streakTab === 'mystats'} onClick={() => setStreakTab('mystats')}>My Streaks</TabBtn>
            </div>

            {streakTab === 'mystats' ? (
              <>
                <div className="streak-my">
                  <div className="streak-row">
                    <div className="streak-chip">Current: <b>{currentStreak}</b></div>
                    <div className="streak-chip">Best: <b>{bestStreak}</b></div>
                  </div>

                  <div className="handle-row">
                    <label htmlFor="handle" className="handle-label">@ Handle</label>
                    <input
                      id="handle"
                      className="handle-input"
                      placeholder="yourname"   // no '@' in the field
                      value={handle}
                      inputMode="text"
                      pattern="[A-Za-z0-9_.-]*"
                      title="Use letters, numbers, underscore, dot, or dash"
                      onChange={(e) => setHandle(normalizeHandle(e.target.value))}
                    />
                    <button className="handle-save" onClick={saveHandle}>Save</button>
                  </div>

                  {/* Team logo picker */}
                  <div className="team-picker">
                    <div className="team-picker-label">Team logo (optional)</div>
                    <div className="team-grid">
                      {TEAM_CODES.map(code => {
                        const file = teamCodeToFile(code);
                        const active = teamChoice === code;
                        return (
                          <button
                            key={code}
                            type="button"
                            className={`team-btn ${active ? 'active' : ''}`}
                            onClick={() => setTeamChoice(code)}
                            title={code}
                          >
                            <img
                              src={`${PUB}/logos/${file}.png`}
                              alt={code}
                              loading="lazy"
                            />
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {!supaReady && (
                    <div className="streak-note">
                      Leaderboard is offline (missing Supabase env keys). Local streaks still work.
                    </div>
                  )}
                </div>

                {/* Heatmap only (badges panel removed) */}
                <h3 className="lb-title">Daily Play Calendar</h3>
                <div className="lb-box" style={{padding:'12px'}}>
                  <StreakCalendar plays={plays} />
                </div>
              </>
            ) : (
              <>
                <h3 className="lb-title">Leaderboard (Best Streak)</h3>
                <div className="lb-box">
                  {lbLoading ? (
                    <div className="lb-loading">Loading…</div>
                  ) : lbError ? (
                    <div className="lb-error">{lbError}</div>
                  ) : (
                    <table className="streak-table">
                      <thead>
                        <tr><th>#</th><th>Handle</th><th>Best</th><th>Current</th></tr>
                      </thead>
                      <tbody>
                        {(leaderboard || []).map((r, i) => {
                          const rowBadges = Array.isArray(r.badges) ? r.badges : [];
                          return (
                            <tr key={r.handle || i} className={handle && r.handle === handle ? 'me' : ''}>
                              <td>{i + 1}</td>
                              <td className="handle-cell">
                                {rowBadges.slice(0,4).map(b => <BadgeDot key={`${r.handle}-${b}`} id={b} />)}
                                {r.team && (
                                  <img
                                    src={`${PUB}/logos/${teamCodeToFile(r.team)}.png`}
                                    alt={r.team}
                                    className="lb-team"
                                  />
                                )}
                                @{r.handle}
                              </td>
                              <td>{(r.best_streak ?? 0)}</td>
                              <td>{(r.current_streak ?? r.streak ?? 0)}</td>
                            </tr>
                          );
                        })}
                        {(!leaderboard || leaderboard.length === 0) && (
                          <tr><td colSpan="4" style={{textAlign:'center', opacity:.7}}>No entries yet.</td></tr>
                        )}
                      </tbody>
                    </table>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ⏪ Archive modal */}
      {showArchive && (
        <div className="archive-modal-overlay" onClick={() => setShowArchive(false)}>
          <div className="archive-modal" onClick={(e) => e.stopPropagation()}>
            <button className="archive-close" onClick={() => setShowArchive(false)} aria-label="Close">×</button>
            <h2 className="archive-title">Archive Day</h2>
            <p className="archive-sub">Play a past puzzle (no locks, no streak changes).</p>
            <div className="archive-row">
              <label htmlFor="archiveDate">Choose date</label>
              <input
                id="archiveDate"
                type="date"
                value={archiveDate}
                onChange={(e) => setArchiveDate(e.target.value)}
              />
            </div>
            <div className="archive-actions">
              <button className="archive-go" onClick={goArchive}>Play This Day</button>
              <button className="archive-cancel" onClick={() => setShowArchive(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function getFeedbackClass(feedback) {
  if (!feedback) return 'incorrect';
  if (feedback.emoji === '✅') return 'correct';
  if (feedback.emoji === '🟡') return 'close';
  return 'incorrect';
}

function getFeedbackClassTeam(feedback) {
  if (!feedback) return 'incorrect';
  if (feedback.includes('✅')) return 'correct';
  if (feedback.includes('🟡')) return 'close';
  return 'incorrect';
}

function getFeedbackClassSimple(feedback) {
  if (!feedback) return 'incorrect';
  if (feedback === '✅') return 'correct';
  if (feedback === '🟡') return 'close';
  return 'incorrect';
}

/* Shot clock (MM:SS) */
function ShotClock({ seconds = 0 }) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;

  return (
    <div className="shot-clock" aria-label="Timer">
      <span className="digits">
        {String(mins).padStart(2, '0')}
        <span className="blinking-colon">:</span>
        {String(secs).padStart(2, '0')}
      </span>
    </div>
  );
}

export default App;
