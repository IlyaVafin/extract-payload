export interface LinkedinProfile {
  name: string | null;

  profileUrl: string;
  publicIdentifier: string | null;

  memberId: string | null;
  memberUrn: string | null;
}

export function extractPayload(content: string): LinkedinProfile[] {
  const profiles = new Map<string, LinkedinProfile>();

  const canonicalRe =
    /"profileCanonicalUrl"\s*:\s*"(https:\/\/www\.linkedin\.com\/in\/[^"]+)"[\s\S]{0,2000}?((?:urn:li:member:(\d+))|(?:"memberId"\s*:\s*"(\d+)"))/g;

  let m: RegExpExecArray | null;

  while ((m = canonicalRe.exec(content)) !== null) {
    const profileUrl = normalizeLinkedinUrl(m[1]);
    const memberId = m[3] ?? m[4] ?? null;

    upsert(profiles, profileUrl, { memberId });
  }

  const inviteRe =
    /"inviteeUrn"\s*:\s*\{\s*"memberId"\s*:\s*"(\d+)"\s*\}[\s\S]{0,2000}?"profileCanonicalUrl"\s*:\s*"(https:\/\/www\.linkedin\.com\/in\/[^"]+)"/g;

  while ((m = inviteRe.exec(content)) !== null) {
    const memberId = m[1];
    const profileUrl = normalizeLinkedinUrl(m[2]);

    upsert(profiles, profileUrl, { memberId });
  }

  const urlRe =
    /"profileCanonicalUrl"\s*:\s*"(https:\/\/www\.linkedin\.com\/in\/[^"]+)"/g;

  /**
   * 2. NAME BLOCK (firstName + lastName → name)
   */

  let n: RegExpExecArray | null;

  while ((n = urlRe.exec(content)) !== null) {
    const profileUrl = normalizeLinkedinUrl(n[1]);

    // берём небольшой кусок вокруг URL (потому что SDUI вложенный)
    const start = Math.max(0, n.index - 5000);
    const end = Math.min(content.length, n.index + 5000);

    const chunk = content.slice(start, end);

    const firstName = /"firstName"\s*:\s*"([^"]+)"/.exec(chunk)?.[1];
    const lastName = /"lastName"\s*:\s*"([^"]+)"/.exec(chunk)?.[1];

    const fullName =
      firstName && lastName ? `${firstName} ${lastName}`.trim() : null;

    const existing = profiles.get(profileUrl);

    profiles.set(profileUrl, {
      ...existing!,
      name: fullName ?? existing?.name ?? null,
    });
  }

  /**
   * 4. URL fallback
   */

  while ((m = urlRe.exec(content)) !== null) {
    const profileUrl = normalizeLinkedinUrl(m[1]);

    if (profiles.has(profileUrl)) continue;

    const memberId = findNearestMemberId(content, m.index);

    upsert(profiles, profileUrl, { memberId });
  }

  return Array.from(profiles.values());
}

/**
 * MERGE LOGIC
 */
function upsert(
  map: Map<string, LinkedinProfile>,
  profileUrl: string,
  patch: Partial<LinkedinProfile>,
) {
  const existing = map.get(profileUrl);

  const merged: LinkedinProfile = {
    profileUrl,

    publicIdentifier:
      existing?.publicIdentifier ?? extractPublicIdentifier(profileUrl),

    memberId: patch.memberId ?? existing?.memberId ?? null,

    memberUrn: null,

    name: patch.name ?? existing?.name ?? null,
  };

  merged.memberUrn = merged.memberId
    ? `urn:li:member:${merged.memberId}`
    : null;

  map.set(profileUrl, merged);
}

/**
 * nearest memberId
 */
function findNearestMemberId(
  content: string,
  pos: number,
  radius = 3000,
): string | null {
  const start = Math.max(0, pos - radius);
  const end = Math.min(content.length, pos + radius);

  const chunk = content.slice(start, end);

  const regex = /urn:li:member:(\d+)/g;

  let best: { id: string; dist: number } | null = null;

  let m: RegExpExecArray | null;

  while ((m = regex.exec(chunk)) !== null) {
    const absolute = start + m.index;
    const dist = Math.abs(absolute - pos);

    if (!best || dist < best.dist) {
      best = { id: m[1], dist };
    }
  }

  return best?.id ?? null;
}

/**
 * utils
 */
function normalizeLinkedinUrl(url: string): string {
  return url
    .replace(/\\u002F/g, '/')
    .replace(/\/(ru|fr|de|es|it|pl|uk)\/?$/, '')
    .replace(/\/+$/, '')
    .trim();
}

function extractPublicIdentifier(url: string): string | null {
  const m = /^https:\/\/www\.linkedin\.com\/in\/([^/?#]+)/.exec(url);

  return m ? decodeURIComponent(m[1]) : null;
}
