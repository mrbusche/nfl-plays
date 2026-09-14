const POLL_INTERVAL_SEC = 30;
let countdown = POLL_INTERVAL_SEC;
const knownPlayIds = new Set();

function isKickoffOrPunt(play) {
  const text = (play.text || '').toLowerCase();
  const playType = (play.type?.text || '').toLowerCase();

  if (
    text.includes('kicks off') ||
    text.includes('kickoff') ||
    text.includes('onside kick') ||
    text.includes('punts for') ||
    text.includes('punt') ||
    text.includes('end quarter')
  ) {
    return true;
  }

  return playType.includes('punt') || playType.includes('kickoff');
}

function calculateChronologicalWeight(play) {
  if (play.wallclock) {
    return new Date(play.wallclock).getTime();
  }

  const period = play.period?.number || 1;
  const clockSeconds = parseClockToSeconds(play.clock?.displayValue || '00:00');
  return (period - 1) * 15 * 60 + (15 * 60 - clockSeconds);
}

function parseClockToSeconds(clockStr) {
  const parts = clockStr.split(':').map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

async function fetchLivePlays() {
  countdown = POLL_INTERVAL_SEC;
  const statusText = document.getElementById('engine-status');
  statusText.innerText = 'Syncing live plays...';

  try {
    const scoreRes = await fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard');
    const scoreData = await scoreRes.json();
    const events = scoreData.events || [];

    if (!events.length) {
      document.getElementById('play-feed').innerHTML = `
        <div class="empty-state">No NFL games found on the scoreboard today.</div>
      `;
      statusText.innerText = 'Idle';
      return;
    }

    let activeGames = events.filter((e) => e.status?.type?.state === 'in');
    if (activeGames.length === 0) {
      activeGames = events.slice(0, 4);
    }

    renderGamesBar(events);

    const summaryPromises = activeGames.map(async (game) => {
      try {
        const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${game.id}`);
        const data = await res.json();
        return { game, data };
      } catch (err) {
        console.error(`Failed to fetch game summary for ${game.id}:`, err);
        return null;
      }
    });

    const summaries = (await Promise.all(summaryPromises)).filter(Boolean);
    const allFilteredPlays = [];

    summaries.forEach(({ game, data }) => {
      const homeTeam = game.competitions?.[0]?.competitors?.find((c) => c.homeAway === 'home');
      const awayTeam = game.competitions?.[0]?.competitors?.find((c) => c.homeAway === 'away');
      const matchupStr = `${awayTeam?.team?.abbreviation || 'AWAY'} @ ${homeTeam?.team?.abbreviation || 'HOME'}`;
      const scoreStr = `${awayTeam?.team?.abbreviation} ${awayTeam?.score || 0} - ${homeTeam?.score || 0} ${homeTeam?.team?.abbreviation}`;

      const drives = data.drives?.previous || [];
      if (data.drives?.current) {
        drives.push(data.drives.current);
      }

      drives.forEach((drive) => {
        (drive.plays || []).forEach((play) => {
          if (isKickoffOrPunt(play)) {
            return;
          }

          allFilteredPlays.push({
            id: play.id || `${game.id}-${play.sequenceNumber || Math.random()}`,
            text: play.text,
            downDistanceText: play.downDistanceText || '',
            period: play.period?.number || 1,
            clock: play.clock?.displayValue || '',
            statYardage: play.statYardage || 0,
            type: play.type?.text || 'Play',
            matchup: matchupStr,
            score: scoreStr,
            chronologicalWeight: calculateChronologicalWeight(play),
            isScoring: play.scoringPlay || false,
          });
        });
      });
    });

    allFilteredPlays.sort((a, b) => b.chronologicalWeight - a.chronologicalWeight);
    renderFeed(allFilteredPlays);
    statusText.innerText = `Active • ${activeGames.length} game(s) tracked`;
  } catch (err) {
    console.error('Error updating plays:', err);
    statusText.innerText = 'Error syncing feeds';
  }
}

function renderGamesBar(events) {
  const bar = document.getElementById('games-bar');
  bar.innerHTML = events
    .map((ev) => {
      const comp = ev.competitions?.[0];
      const away = comp?.competitors?.find((c) => c.homeAway === 'away');
      const home = comp?.competitors?.find((c) => c.homeAway === 'home');
      const status = ev.status?.type?.shortDetail || 'Scheduled';

      return `
        <div class="game-badge">
          <span><strong>${away?.team?.abbreviation}</strong> ${away?.score || 0} - ${home?.score || 0} <strong>${home?.team?.abbreviation}</strong></span>
          <span class="status">${status}</span>
        </div>
      `;
    })
    .join('');
}

function renderFeed(plays) {
  const feed = document.getElementById('play-feed');

  if (plays.length === 0) {
    feed.innerHTML = `<div class="empty-state">No non-special teams plays logged yet.</div>`;
    return;
  }

  const dedupedPlays = plays.filter((play, index) => {
    if (index === 0) return true;
    const prev = plays[index - 1];
    return !(play.text === prev.text && play.matchup === prev.matchup && play.period === prev.period && play.clock === prev.clock);
  });

  const recentPlays = dedupedPlays.slice(0, 75);

  feed.innerHTML = recentPlays
    .map((play) => {
      const isNew = !knownPlayIds.has(play.id);
      knownPlayIds.add(play.id);

      let badgeHtml = `<span class="badge badge-play">${play.type}</span>`;
      const txt = play.text.toLowerCase();
      if (txt.includes('touchdown')) {
        badgeHtml = `<span class="badge badge-td">TOUCHDOWN</span>`;
      } else if (txt.includes('intercepted') || txt.includes('fumble recovered')) {
        badgeHtml = `<span class="badge badge-turnover">TURNOVER</span>`;
      } else if (txt.includes('field goal is good')) {
        badgeHtml = `<span class="badge badge-fg">FIELD GOAL</span>`;
      }

      return `
        <article class="play-card ${isNew ? 'new-play' : ''}">
          <div class="play-header">
            <span class="matchup-tag">${play.matchup} (${play.score})</span>
            <span class="game-situation">Q${play.period} ${play.clock} • ${play.downDistanceText}</span>
          </div>
          <p class="play-body">${play.text}</p>
          <div class="play-footer">
            ${badgeHtml}
            ${play.statYardage !== 0 ? `<span class="yard-stat">${play.statYardage > 0 ? '+' : ''}${play.statYardage} yds</span>` : ''}
          </div>
        </article>
      `;
    })
    .join('');
}

function startPolling() {
  fetchLivePlays();
  timerInterval = setInterval(() => {
    if (document.hidden) {
      return;
    }
    countdown--;
    document.getElementById('poll-timer').innerText = `Next: ${countdown}s`;
    if (countdown <= 0) {
      fetchLivePlays();
    }
  }, 1000);
}

document.getElementById('refresh-btn').addEventListener('click', fetchLivePlays);

document.addEventListener('visibilitychange', () => {
  const statusText = document.getElementById('engine-status');
  if (document.hidden) {
    statusText.innerText = 'Paused (tab inactive)';
  } else {
    fetchLivePlays();
  }
});

startPolling();
