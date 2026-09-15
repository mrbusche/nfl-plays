import { describe, expect, it } from 'vitest';
import {
  calculateChronologicalWeight,
  cleanPlayText,
  getPlayBadge,
  isIncompletePass,
  isKickoffOrPunt,
  isPenalty,
  normalizePlay,
  parseClockToSeconds,
} from './play-utils.js';

describe('incoming play filtering', () => {
  it.each([
    ['kicks off text', { text: 'Kicks off 65 yards to the end zone' }],
    ['kickoff text', { text: 'Kickoff returned 20 yards' }],
    ['onside kick text', { text: 'Onside kick recovered by the kicking team' }],
    ['punts for text', { text: 'Player punts for 42 yards' }],
    ['punt text', { text: 'Punt 45 yards' }],
    ['end quarter text', { text: 'End Quarter 1' }],
    ['punt type', { text: 'Play', type: { text: 'Punt' } }],
    ['kickoff type', { text: 'Play', type: { text: 'Kickoff' } }],
  ])('identifies %s as a special teams play', (_, play) => {
    expect(isKickoffOrPunt(play)).toBe(true);
  });

  it.each([
    ['ordinary play', { text: 'Pass complete to WR for 12 yards' }],
    ['uppercase ordinary type', { text: 'Run', type: { text: 'Rushing' } }],
    ['missing fields', {}],
  ])('keeps %s', (_, play) => {
    expect(isKickoffOrPunt(play)).toBe(false);
  });
});

describe('penalty filtering', () => {
  it.each([
    ['declined penalty', 'Penalty on DEN-G.Bolles, Ineligible Downfield Pass, declined.'],
    ['uppercase penalty', 'PENALTY on the defense'],
    ['penalty in the middle', 'Pass complete for 8 yards. Penalty enforced.'],
  ])('identifies a %s', (_, text) => {
    expect(isPenalty({ text })).toBe(true);
  });

  it.each([{}, { text: '' }, { text: 'Pass complete for 8 yards' }])('does not reject %s', (play) => {
    expect(isPenalty(play)).toBe(false);
  });
});

describe('incomplete pass filtering', () => {
  it.each(['P.Mahomes pass incomplete short right to C.Allen.', 'B.Nix pass incomplete short right to P.Bryant.'])(
    'identifies "%s" as an incomplete pass',
    (text) => {
      expect(isIncompletePass({ text })).toBe(true);
      expect(normalizePlay({ id: 'incomplete-1', text }, { id: 'game-1' })).toBeNull();
    },
  );

  it('keeps completed passes', () => {
    expect(isIncompletePass({ text: 'P.Mahomes pass short right to C.Allen for 8 yards.' })).toBe(false);
  });
});

describe('incoming play normalization', () => {
  it('maps an ESPN play into the feed shape', () => {
    expect(
      normalizePlay(
        {
          id: 'play-1',
          text: 'Pass complete to WR for 12 yards',
          downDistanceText: '2nd & 8',
          period: { number: 2 },
          clock: { displayValue: '08:30' },
          statYardage: 12,
          type: { text: 'Pass' },
          scoringPlay: false,
        },
        { id: 'game-1', matchup: 'AWY @ HOM', score: 'AWY 7 - 3 HOM' },
      ),
    ).toEqual({
      id: 'play-1',
      text: 'Pass complete to WR for 12 yards',
      downDistanceText: '2nd & 8',
      period: 2,
      clock: '08:30',
      statYardage: 12,
      type: 'Pass',
      matchup: 'AWY @ HOM',
      score: 'AWY 7 - 3 HOM',
      chronologicalWeight: 1290,
      isScoring: false,
    });
  });

  it('omits kickoff and punt plays', () => {
    expect(normalizePlay({ id: 'punt-1', text: 'Punt 45 yards' }, { id: 'game-1' })).toBeNull();
  });

  it('omits plays that contain a penalty', () => {
    expect(
      normalizePlay(
        {
          id: 'penalty-1',
          text: '(2:43) B.Nix pass incomplete short right to A.Trautman [G.Karlaftis]. Penalty on DEN-G.Bolles, Ineligible Downfield Pass, declined.',
        },
        { id: 'game-1' },
      ),
    ).toBeNull();
  });

  it('removes parenthetical defender annotations from play text', () => {
    expect(cleanPlayText('R.Harvey right end to DEN 23 for 6 yards (N.Bolton).')).toBe('R.Harvey right end to DEN 23 for 6 yards.');
    expect(cleanPlayText('B.Nix pass short left to E.Engram to DEN 17 for 9 yards (N.Williams; L.Sneed).')).toBe(
      'B.Nix pass short left to E.Engram to DEN 17 for 9 yards.',
    );
  });

  it('stores cleaned text in the normalized play output', () => {
    expect(normalizePlay({ id: 'play-2', text: 'R.Harvey right end to DEN 23 for 6 yards (N.Bolton).' }, { id: 'game-1' }).text).toBe(
      'R.Harvey right end to DEN 23 for 6 yards.',
    );
  });

  it('uses a stable fallback id when ESPN omits the play id', () => {
    expect(normalizePlay({ sequenceNumber: 17, text: 'Rush for 4 yards' }, { id: 'game-1' }).id).toBe('game-1-17');
  });

  it('uses the unknown fallback when both id and sequence number are missing', () => {
    expect(normalizePlay({ text: 'Rush for 4 yards' }, { id: 'game-1' }).id).toBe('game-1-unknown');
  });

  it('applies defaults for optional play fields', () => {
    expect(normalizePlay({ text: '' }, { id: 'game-1', matchup: undefined, score: undefined })).toMatchObject({
      text: '',
      downDistanceText: '',
      period: 1,
      clock: '',
      statYardage: 0,
      type: 'Play',
      matchup: undefined,
      score: undefined,
      isScoring: false,
    });
  });

  it('preserves positive scoring and negative yardage values', () => {
    expect(
      normalizePlay(
        {
          id: 'score-1',
          text: 'Touchdown run for 5 yards',
          statYardage: -2,
          scoringPlay: true,
        },
        { id: 'game-1' },
      ),
    ).toMatchObject({ statYardage: -2, isScoring: true });
  });
});

describe('play output metadata', () => {
  it.each([
    ['12:34', 754],
    ['00:00', 0],
    ['5:07', 307],
  ])('converts %s to seconds', (clock, expected) => {
    expect(parseClockToSeconds(clock)).toBe(expected);
  });

  it.each(['', '12', '12:34:56', 'not-a-clock'])('returns zero for invalid clock %s', (clock) => {
    expect(parseClockToSeconds(clock)).toBe(0);
  });

  it('orders later periods after earlier periods', () => {
    expect(calculateChronologicalWeight({ period: { number: 2 }, clock: { displayValue: '14:59' } })).toBeGreaterThan(
      calculateChronologicalWeight({ period: { number: 1 }, clock: { displayValue: '00:01' } }),
    );
  });

  it('uses wall-clock time when available', () => {
    const wallclock = '2026-09-14T19:00:00.000Z';
    expect(calculateChronologicalWeight({ wallclock, period: { number: 1 }, clock: { displayValue: '00:01' } })).toBe(
      new Date(wallclock).getTime(),
    );
  });

  it('uses first-period zero-time defaults when clock fields are missing', () => {
    expect(calculateChronologicalWeight({})).toBe(900);
  });

  it('handles an explicit zero period as the default period', () => {
    expect(calculateChronologicalWeight({ period: { number: 0 }, clock: { displayValue: '15:00' } })).toBe(0);
  });

  it.each([
    ['Touchdown run', 'Run', 'TOUCHDOWN'],
    ['Pass intercepted by defender', 'Pass', 'TURNOVER'],
    ['Field goal is good from 32 yards', 'Field Goal', 'FIELD GOAL'],
    ['Rush for 5 yards', 'Rush', 'Rush'],
  ])('classifies %s for display', (text, type, expected) => {
    expect(getPlayBadge(text, type)).toBe(expected);
  });

  it('matches badge text case-insensitively', () => {
    expect(getPlayBadge('TOUCHDOWN pass', 'Pass')).toBe('TOUCHDOWN');
    expect(getPlayBadge('FIELD GOAL IS GOOD', 'Kick')).toBe('FIELD GOAL');
  });

  it('gives touchdown precedence over other matching text', () => {
    expect(getPlayBadge('Touchdown pass intercepted', 'Pass')).toBe('TOUCHDOWN');
  });

  it('returns the supplied type for an empty play description', () => {
    expect(getPlayBadge('', 'Rush')).toBe('Rush');
  });
});

describe('play text cleaning', () => {
  it.each([
    ['no annotations', 'Rush for 4 yards', 'Rush for 4 yards'],
    ['leading and trailing whitespace', '  Rush for 4 yards  ', 'Rush for 4 yards'],
    ['multiple annotations', 'Run for 3 yards (A.Player) (B.Player).', 'Run for 3 yards.'],
    ['empty text', '', ''],
  ])('cleans %s', (_, text, expected) => {
    expect(cleanPlayText(text)).toBe(expected);
  });
});
