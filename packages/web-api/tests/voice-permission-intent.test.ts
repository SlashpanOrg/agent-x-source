import { describe, expect, it } from 'vitest';
import { classifyVoicePermissionUtterance } from '../src/voice-permission-intent.js';

describe('classifyVoicePermissionUtterance', () => {
  it.each([
    'yes',
    'yeah',
    'yep',
    'sure',
    'ok',
    'okay',
    'go ahead',
    'yes please',
    'yeah do it',
    'sounds good',
    'please do',
    'alright',
  ])('treats %j as allow', (utterance) => {
    expect(classifyVoicePermissionUtterance(utterance)).toBe('allow_once');
  });

  it.each([
    'no',
    'nope',
    'nah',
    'no thanks',
    'stop',
    'cancel',
    'skip',
    "don't",
    'not now',
    'hold off',
  ])('treats %j as deny', (utterance) => {
    expect(classifyVoicePermissionUtterance(utterance)).toBe('deny');
  });

  it.each([
    '',
    '   ',
    'what',
    'hmm',
    'maybe',
    'which tools',
    'ok but also search the web for cats then write a long report about it',
  ])('treats %j as unclear', (utterance) => {
    expect(classifyVoicePermissionUtterance(utterance)).toBeNull();
  });

  it('prefers deny when yes and no are mixed without a clear proceed', () => {
    expect(classifyVoicePermissionUtterance("no don't")).toBe('deny');
  });
});
