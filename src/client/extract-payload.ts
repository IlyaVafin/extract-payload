import fs from 'fs';
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

interface WorkExperience {
  position: string;
  companyName: string;
  companyLogoUrl: string;
  period: string;
  duration: string;
  location: string;
}

export function extractWorkExperience(jsonContent: string): WorkExperience[] {
  try {
    const components: Record<string, any> = {};

    // Парсим блоки вида "abc:I[...]"
    const blocks = jsonContent.split(/^(?=[a-f0-9]+:)/m);

    for (const block of blocks) {
      if (!block.trim()) continue;

      const lines = block.split('\n');
      const firstLine = lines[0];

      const match = firstLine.match(/^([a-f0-9]+):I?(.*)/);

      if (!match) continue;

      const key = match[1];

      const jsonStr =
        firstLine.substring(firstLine.indexOf(match[2])) +
        '\n' +
        lines.slice(1).join('\n');

      try {
        components[key] = JSON.parse(jsonStr.trim());
      } catch {
        // skip
      }
    }

    const root = components['3']; // ExperienceTopLevelSection

    if (!root) {
      return [];
    }

    const experiences: WorkExperience[] = [];

    function collectStrings(node: any, result: string[] = []): string[] {
      if (typeof node === 'string') {
        result.push(node);
        return result;
      }

      if (Array.isArray(node)) {
        for (const item of node) {
          collectStrings(item, result);
        }
      } else if (node && typeof node === 'object') {
        for (const value of Object.values(node)) {
          collectStrings(value, result);
        }
      }

      return result;
    }

    function extractUsefulStrings(card: any): string[] {
      const all = collectStrings(card);

      return all.filter((text) => {
        if (!text) return false;

        if (
          text === '$' ||
          text.startsWith('$L') ||
          text.startsWith('proto.') ||
          text.startsWith('var(--') ||
          text === '$undefined'
        ) {
          return false;
        }

        if (
          [
            'open',
            'start',
            'end',
            'center',
            'horizontal',
            'vertical',
            'normal',
            'small',
            'medium',
            'large',
            'sans',
            'none',
            'click',
            'url',
            'screen',
          ].includes(text)
        ) {
          return false;
        }

        if (text.startsWith('_') || text.includes('entity-collection-item')) {
          return false;
        }

        return true;
      });
    }

    function findExperienceCards(node: any, result: any[] = []): any[] {
      if (!node) return result;

      if (
        node &&
        typeof node === 'object' &&
        typeof node.componentKey === 'string' &&
        node.componentKey.startsWith('entity-collection-item-')
      ) {
        result.push(node);
      }

      if (Array.isArray(node)) {
        for (const item of node) {
          findExperienceCards(item, result);
        }
      } else if (typeof node === 'object') {
        for (const value of Object.values(node)) {
          findExperienceCards(value, result);
        }
      }

      return result;
    }

    function extractCardData(card: any): WorkExperience | null {
      const texts: string[] = [];

      function walk(node: any) {
        if (!node) return;

        if (typeof node === 'string') {
          texts.push(node);
          return;
        }

        if (Array.isArray(node)) {
          node.forEach(walk);
          return;
        }

        if (typeof node === 'object') {
          if (node.children) walk(node.children);
          else Object.values(node).forEach(walk);
        }
      }

      walk(card);

      const clean = texts.filter(
        (t) =>
          t &&
          !t.startsWith('$') &&
          !/^[a-z0-9_]{10,}/i.test(t) &&
          !t.includes('entity-collection-item'),
      );

      const position =
        clean.find(
          (t) => !t.includes('·') && !t.includes('мес') && t.length < 80,
        ) || '';

      const companyLine = clean.find((t) => t.includes('·')) || '';
      const period =
        clean.find((t) => /(\d{4}|настоящее).*(мес|лет|г\.)/i.test(t)) || '';

      const location =
        clean.find((t) => /[А-ЯA-Za-z].*,\s?[А-ЯA-Za-z]/.test(t)) || '';

      const companyName = companyLine.split('·')[0].trim();

      const duration = period.includes('·') ? period.split('·')[1].trim() : '';

      return {
        position: position.trim(),
        companyName,
        companyLogoUrl: '',
        period,
        duration,
        location,
      };
    }

    const cards = findExperienceCards(root);

    for (const card of cards) {
      const exp = extractCardData(card);
      if (exp?.position && exp?.companyName) {
        experiences.push(exp);
      }
    }

    return experiences;
  } catch (error) {
    console.error('Error parsing work experience:', error);
    return [];
  }
}

function findLogoNode(node: any): any {
  if (!node) return null;

  if (node?.renderPayload?.imageRenditions?.length) {
    return node;
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findLogoNode(item);

      if (found) {
        return found;
      }
    }
  } else if (typeof node === 'object') {
    for (const value of Object.values(node)) {
      const found = findLogoNode(value);

      if (found) {
        return found;
      }
    }
  }

  return null;
}
const content = fs.readFileSync('./expirience-payload2.json', 'utf-8');
const result = extractWorkExperience(content);
console.log(result);
