export function isKickoffOrPunt(play) {
  const text = (play.text || '').toLowerCase();
  const playType = (play.type?.text || '').toLowerCase();

  return (
    text.includes('kicks off') ||
    text.includes('kickoff') ||
    text.includes('onside kick') ||
    text.includes('punts for') ||
    text.includes('punt') ||
    text.includes('end quarter') ||
    playType.includes('punt') ||
    playType.includes('kickoff')
  );
}

export function isPenalty(play) {
  return (play.text || '').toLowerCase().includes('penalty');
}

export function cleanPlayText(text) {
  return text.replace(/\s*\([^)]*\)/g, '').trim();
}

export function parseClockToSeconds(clockStr) {
  const parts = clockStr.split(':').map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

export function calculateChronologicalWeight(play) {
  if (play.wallclock) {
    return new Date(play.wallclock).getTime();
  }

  const period = play.period?.number || 1;
  const clockSeconds = parseClockToSeconds(play.clock?.displayValue || '00:00');
  return (period - 1) * 15 * 60 + (15 * 60 - clockSeconds);
}

export function normalizePlay(play, game) {
  if (isKickoffOrPunt(play) || isPenalty(play)) return null;

  return {
    id: play.id || `${game.id}-${play.sequenceNumber || 'unknown'}`,
    text: cleanPlayText(play.text || ''),
    downDistanceText: play.downDistanceText || '',
    period: play.period?.number || 1,
    clock: play.clock?.displayValue || '',
    statYardage: play.statYardage || 0,
    type: play.type?.text || 'Play',
    matchup: game.matchup,
    score: game.score,
    chronologicalWeight: calculateChronologicalWeight(play),
    isScoring: play.scoringPlay || false,
  };
}

export function getPlayBadge(text, type) {
  const normalizedText = text.toLowerCase();

  if (normalizedText.includes('touchdown')) return 'TOUCHDOWN';
  if (normalizedText.includes('intercepted') || normalizedText.includes('fumble recovered')) {
    return 'TURNOVER';
  }
  if (normalizedText.includes('field goal is good')) return 'FIELD GOAL';
  return type;
}
