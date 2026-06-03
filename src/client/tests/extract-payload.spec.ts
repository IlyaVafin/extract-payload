import { extractPayload } from '../extract-payload';

describe('extract-payload', () => {
  it('Должен успешно парсить профили', async () => {
    const result = await extractPayload(
      'C:\\Users\\Илья\\Desktop\\l\\src\\client\\linkedin-profile-you-may-know-success-response.json',
    );
    expect(result).toBeInstanceOf(Array);
    for (const profile of result) {
      expect(profile).toHaveProperty('name');
      expect(profile).toHaveProperty('profileUrl');
      expect(profile).toHaveProperty('publicIdentifier');
      expect(profile).toHaveProperty('memberId');
      expect(profile).toHaveProperty('memberUrn');
      expect(profile.profileUrl).toBeTruthy();
      expect(profile.publicIdentifier).toBeTruthy();
      expect(profile.memberId).toBeTruthy();
      expect(profile.memberUrn).toBeTruthy();
      expect(profile.name).toBeTruthy();
    }
  });
});
