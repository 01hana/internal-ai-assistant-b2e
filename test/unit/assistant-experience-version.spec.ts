import { nextExperienceVersion } from '../../src/assistant-experience/assistant-experience.repository';

/** Feature 016: admin saves number versions automatically. */
describe('nextExperienceVersion', () => {
  it('starts at 1.0.0', () => {
    expect(nextExperienceVersion([])).toBe('1.0.0');
  });

  it('increments the patch of the highest version, comparing numbers rather than text', () => {
    expect(nextExperienceVersion(['1.0.9', '1.0.10', '1.0.2'])).toBe('1.0.11');
    expect(nextExperienceVersion(['1.2.0', '1.10.0'])).toBe('1.10.1');
  });
});
