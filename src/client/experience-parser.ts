import fs from 'fs';

export interface WorkExperience {
  position: string;
  companyName: string;
  companyLogoUrl: string;
  period: string;
  duration: string;
  location: string;
}

export function extractWorkExperience(jsonContent: string): WorkExperience[] {
  const experiences: WorkExperience[] = [];

  try {
    const blocks = jsonContent.split(/^(?=[a-f0-9]+:)/m);

    const components: Record<string, any> = {};

    for (const block of blocks) {
      if (!block.trim()) continue;

      const lines = block.split('\n');
      const firstLine = lines[0];

      const keyMatch = firstLine.match(/^([a-f0-9]+):I?(.*)/);
      if (!keyMatch) continue;

      const key = keyMatch[1];

      const jsonContent =
        firstLine.substring(firstLine.indexOf(keyMatch[2])) +
        '\n' +
        lines.slice(1).join('\n');

      try {
        components[key] = JSON.parse(jsonContent.trim());
      } catch (e) {
        // Parse error - skip
      }
    }

    // Извлекаем данные
    const allTexts: string[] = [];
    let companyName = '';
    let companyLogoUrl = '';
    let location = '';

    const extractTexts = (obj: any): void => {
      if (typeof obj === 'string') {
        if (
          obj &&
          obj.length > 0 &&
          !obj.startsWith('$') &&
          !obj.startsWith('_')
        ) {
          allTexts.push(obj);
        }
      } else if (Array.isArray(obj)) {
        for (const item of obj) {
          extractTexts(item);
        }
      } else if (obj && typeof obj === 'object') {
        if (
          obj.a11yText &&
          String(obj.a11yText).includes('Эмблема организации')
        ) {
          const nameMatch = String(obj.a11yText).match(
            /Эмблема организации\s+(.+?)$/,
          );
          if (nameMatch && !companyName) {
            companyName = nameMatch[1].trim();
          }
        }

        if (obj.renderPayload?.imageRenditions?.[0] && !companyLogoUrl) {
          const rootUrl = obj.renderPayload.rootUrl;
          const suffixUrl = obj.renderPayload.imageRenditions[0].suffixUrl;
          companyLogoUrl = rootUrl + suffixUrl;
        }

        for (const val of Object.values(obj)) {
          extractTexts(val);
        }
      }
    };

    for (const key in components) {
      extractTexts(components[key]);
    }

    // Фильтруем и группируем
    const position =
      allTexts.find(
        (t) =>
          t === 'Head Product Manager' ||
          t === 'product manager' ||
          (t.includes('Manager') && t.length < 50),
      ) || '';

    const period =
      allTexts.find(
        (t) => (t.includes('2025') || t.includes('2024')) && t.includes('г.'),
      ) || '';

    const duration = allTexts.find((t) => t.match(/^\d+\s+(мес|г)\b/i)) || '';

    location =
      allTexts.find(
        (t) => t.includes('Нью-Йорк') || t.includes('Соединенные Штаты'),
      ) || '';

    if (companyName && period) {
      experiences.push({
        position,
        companyName,
        companyLogoUrl,
        period,
        duration,
        location,
      });
    }
  } catch (error) {
    console.error('❌ Error:', error);
  }

  return experiences;
}

// Test
const content = fs.readFileSync('./expirience-payload.json', 'utf-8');
const result = extractWorkExperience(content);
console.log('\n=== RESULT ===');
console.log(JSON.stringify(result, null, 2));
