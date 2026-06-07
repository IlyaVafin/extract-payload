import fetchCookie from 'fetch-cookie';
import fetchBase, { RequestInit, Response } from 'node-fetch';
import { CookieJar } from 'tough-cookie';
type FetchFunction = (url: string, init?: RequestInit) => Promise<Response>;
const nodeFetch: FetchFunction = (url, init) => fetchBase(url, init);
const fetch = fetchCookie<string, RequestInit, Response>(
  nodeFetch,
  new CookieJar(),
) as FetchFunction;

const DEFAULT_BASE_URL = 'https://www.linkedin.com';
const PROFILE_CARDS_BELOW_ACTIVITY_PATH =
  '/flagship-web/rsc-action/actions/component?componentId=com.linkedin.sdui.generated.profile.dsl.impl.profileCardsBelowActivityPart1&sduiid=com.linkedin.sdui.generated.profile.dsl.impl.profileCardsBelowActivityPart1&parentSpanId=sl8FlcYx6VE%3D';

export interface ProfileCardsBelowActivityRequestParams {
  cookie: string;
  vanityName: string;
  vieweeProfileId: string;
  isSelfView?: boolean;
  signal?: AbortSignal;
  referer?: string;
}

export interface ProfileCardsBelowActivityResponse {
  raw: string;
}

export class LinkedInProfileCardsBelowActivityClient {
  private readonly baseURL = DEFAULT_BASE_URL.replace(/\/+$|$/g, '');

  private endpointURL(): string {
    return `${this.baseURL}${PROFILE_CARDS_BELOW_ACTIVITY_PATH}`;
  }

  private extractCsrfFromCookie(cookie: string): string {
    const match = cookie.match(/JSESSIONID="([^"]+)"/);
    if (!match) {
      throw new Error('No JSESSIONID found in cookie');
    }
    return match[1];
  }

  private async warmSession(cookie: string) {
    await fetch(`${this.baseURL}/feed`, {
      headers: {
        Cookie: cookie,
      },
    });
  }

  private buildBinding(key: string) {
    return {
      type: 'com.linkedin.sdui.components.core.BindingImpl',
      value: {
        key,
        namespace: 'MemoryNamespace',
      },
    };
  }

  private buildRequestBody(params: {
    vanityName: string;
    vieweeProfileId: string;
    isSelfView: boolean;
  }) {
    const { vanityName, vieweeProfileId, isSelfView } = params;
    const profileKeyBase = `ProfileComponentState${vanityName}ProfileComponentState`;

    return {
      clientArguments: {
        payload: {
          isSelfView,
          vanityName,
          replaceableSectionArgs: {
            vanityName,
            hideCardsForGoldenGate: false,
            shouldSetupReplaceableComponent: true,
            vieweeProfileId,
            isSelfView,
          },
          profileComponentState: {
            profileId: vanityName,
            shouldRefreshScreenOnReappear: this.buildBinding(
              `ProfileComponentStateShouldRefreshScreen${profileKeyBase}`,
            ),
            shouldFetchFromCache: this.buildBinding(
              `ProfileComponentStateFetchFromCache${profileKeyBase}`,
            ),
            shouldDisplayStickyHeader: this.buildBinding(
              `ProfileComponentStateShouldDisplayStickyHeader${profileKeyBase}`,
            ),
            shouldRefreshLanguageDetailScreen: this.buildBinding(
              `ProfileComponentStateShouldRefreshLanguageDetails${profileKeyBase}`,
            ),
            lastPerformedActionRef: this.buildBinding(
              `ProfileComponentStateLastPerformedActionRef${profileKeyBase}`,
            ),
            shouldFocusOnReappear: this.buildBinding(
              `ProfileComponentStateShouldFocusOnReappear${profileKeyBase}`,
            ),
            shouldFocusFeaturedOnReappear: this.buildBinding(
              `ProfileComponentStateShouldFocusFeaturedOnReappear${profileKeyBase}`,
            ),
            lastFeaturedActionRef: this.buildBinding(
              `ProfileComponentStateLastFeaturedActionRef${profileKeyBase}`,
            ),
            shouldHideProfileCards: this.buildBinding(
              `ProfileComponentStateProfileHideCards${profileKeyBase}`,
            ),
          },
        },
        states: [],
        requestMetadata: {
          $type: 'proto.sdui.common.RequestMetadata',
        },
        screenId: 'com.linkedin.sdui.flagshipnav.profile.Profile',
      },
    };
  }

  async postProfileCardsBelowActivity(
    params: ProfileCardsBelowActivityRequestParams,
  ): Promise<ProfileCardsBelowActivityResponse> {
    const {
      cookie,
      vanityName,
      vieweeProfileId,
      isSelfView = false,
      referer,
      signal,
    } = params;

    await this.warmSession(cookie);
    const csrf = this.extractCsrfFromCookie(cookie);

    const body = this.buildRequestBody({
      vanityName,
      vieweeProfileId,
      isSelfView,
    });

    const response = await fetch(this.endpointURL(), {
      method: 'POST',
      signal,
      headers: {
        Cookie: cookie,
        'csrf-token': csrf,
        'content-type': 'application/json',
        accept: '*/*',
        origin: this.baseURL,
        referer: referer ?? `${this.baseURL}/in/${vanityName}/`,
      },
      body: JSON.stringify(body),
    });

    const raw = await response.text();

    if (!response.ok) {
      const snippet = raw.length > 512 ? `${raw.slice(0, 512)}…` : raw;
      if (response.status === 999) {
        throw new Error('LinkedIn account banned');
      }
      throw new Error(`linkedin: status ${response.status}: ${snippet}`);
    }

    return { raw };
  }
}

interface WorkExperience {
  position: string;
  companyName: string;
  employmentType: string;
  period: string;
  location: string;
  logoUrl: string;
}

export function parseLinkedInExperience(rawContent: string): WorkExperience[] {
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
