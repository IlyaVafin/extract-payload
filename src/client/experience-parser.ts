import fs from 'fs';

interface WorkExperience {
  position: string;
  companyName: string;
  employmentType: string;
  period: string;
  location: string;
  logoUrl: string;
}

function parseLinkedInExperience(filePath: string): WorkExperience[] {
  const rawContent = fs.readFileSync(filePath, { encoding: 'utf-8' });

  // === 1. Логотипы по компаниям ===
  const logoMap: Record<string, string> = {};
  const logoBlocks = [
    ...rawContent.matchAll(
      /"a11yText"\s*:\s*"Эмблема организации ([^"]+)"[\s\S]*?"rootUrl"\s*:\s*"([^"]+)"[\s\S]*?"imageRenditions"\s*:\s*\[([\s\S]*?)\]/g,
    ),
  ];
  for (const m of logoBlocks) {
    const company = m[1];
    const rootUrl = m[2];
    const renditions = m[3];
    const suffixes = [
      ...renditions.matchAll(/"suffixUrl"\s*:\s*"([^"]+)"/g),
    ].map((x) => x[1]);
    const best =
      suffixes.find((s) => s.includes('200_200')) ||
      suffixes.find((s) => s.includes('100_100')) ||
      suffixes[0] ||
      '';
    logoMap[company] = best ? `${rootUrl}${best}` : 'Нет фото';
  }

  // === 2. Собираем все текстовые "children": ["..."] ===
  const allTexts: { text: string; index: number }[] = [];
  const textRegex = /"children"\s*:\s*\[\s*"([^"\\]+)"\s*\]/g;
  let match;
  while ((match = textRegex.exec(rawContent)) !== null) {
    const text = match[1].trim();
    if (
      text.length > 1 &&
      !text.startsWith('$L') &&
      !text.startsWith('$3:') &&
      !text.startsWith('$11:') &&
      !text.startsWith('$12:') &&
      !text.startsWith('$15:') &&
      !/^[0-9a-f-]{36}$/.test(text) &&
      !text.startsWith('com.linkedin') &&
      !text.startsWith('urn:li:') &&
      !text.startsWith('proto.sdui') &&
      !text.startsWith('var(') &&
      !text.startsWith('--') &&
      !text.startsWith('PresentationStyle') &&
      !text.startsWith('ColorScheme') &&
      !['default', 'null', 'true', 'false', 'SHORT_PRESS'].includes(text)
    ) {
      allTexts.push({ text, index: match.index });
    }
  }

  // === 3. Парсим опыт с определением типа структуры ===
  const experiences: WorkExperience[] = [];
  let i = 0;

  while (i < allTexts.length) {
    const { text } = allTexts[i];

    // Пропускаем заголовки и кнопки
    if (
      text === 'Опыт работы' ||
      text === 'Показать все' ||
      text === 'Образование'
    ) {
      i++;
      continue;
    }

    // Ищем строку с "·"
    if (text.includes('·')) {
      const parts = text.split('·').map((s) => s.trim());
      const leftPart = parts[0];
      const rightPart = parts[1] || '';

      // Определяем тип структуры: смотрим на следующую строку
      const nextText = i + 1 < allTexts.length ? allTexts[i + 1].text : '';
      const isGroupedCompany = !nextText.includes('г.');

      if (isGroupedCompany) {
        // === СТРУКТУРА 2: Группированная компания ===
        const companyName = allTexts[i - 1]?.text || 'Не указана';
        const employmentType = leftPart;
        const overallPeriod = rightPart;

        // Локация компании (если есть)
        let companyLocation = 'Не указана';
        let positionsStartIndex = i + 1;

        if (nextText && !nextText.includes('г.') && nextText.length < 100) {
          companyLocation = nextText;
          positionsStartIndex = i + 2;
        }

        // Собираем все позиции этой компании
        let j = positionsStartIndex;
        let hasPositions = false;

        while (j < allTexts.length) {
          const posText = allTexts[j].text;

          // Если нашли новую строку с "·" — это следующая компания
          if (posText.includes('·')) {
            break;
          }

          // Если это заголовок или кнопка — выходим
          if (
            posText === 'Опыт работы' ||
            posText === 'Показать все' ||
            posText === 'Образование'
          ) {
            break;
          }

          // Это позиция
          const position = posText;
          let period = 'Не указан';
          let location = 'Не указана';

          // Период позиции
          if (j + 1 < allTexts.length && allTexts[j + 1].text.includes('г.')) {
            period = allTexts[j + 1].text;
            j++;

            // Локация позиции (если есть)
            if (j + 1 < allTexts.length) {
              const locText = allTexts[j + 1].text;
              if (
                !locText.includes('г.') &&
                locText.length < 100 &&
                locText !== 'Опыт работы' &&
                locText !== 'Показать все' &&
                locText !== 'Образование' &&
                !locText.includes('навык') &&
                !locText.includes('«')
              ) {
                location = locText;
                j++;
              }
            }
          }

          experiences.push({
            position,
            companyName,
            employmentType,
            period,
            location,
            logoUrl: logoMap[companyName] || 'Нет фото',
          });

          hasPositions = true;
          j++;
        }

        // Если не нашли ни одной позиции, добавляем хотя бы общую запись
        if (!hasPositions) {
          experiences.push({
            position: 'Не указана',
            companyName,
            employmentType,
            period: overallPeriod,
            location: companyLocation,
            logoUrl: logoMap[companyName] || 'Нет фото',
          });
        }

        i = j;
      } else {
        // === СТРУКТУРА 1: Одиночная позиция ===
        const position = allTexts[i - 1]?.text || 'Не указана';
        const companyName = leftPart;
        const employmentType = rightPart;
        const period = nextText;

        // Локация (если есть)
        let location = 'Не указана';
        if (i + 2 < allTexts.length) {
          const locText = allTexts[i + 2].text;
          if (
            !locText.includes('г.') &&
            locText.length < 100 &&
            locText !== 'Опыт работы' &&
            locText !== 'Показать все' &&
            locText !== 'Образование' &&
            !locText.includes('навык') &&
            !locText.includes('«')
          ) {
            location = locText;
          }
        }

        experiences.push({
          position,
          companyName,
          employmentType,
          period,
          location,
          logoUrl: logoMap[companyName] || 'Нет фото',
        });

        i += 3; // Пропускаем: позиция → компания·тип → период → (возможно локация)
      }
    } else {
      i++;
    }
  }

  return experiences;
}

// === ЗАПУСК ===
const result = parseLinkedInExperience('./experience2.json');
console.log('=== РЕЗУЛЬТАТ ИЗВЛЕЧЕНИЯ ДАННЫХ ===');
console.log(JSON.stringify(result, null, 2));
