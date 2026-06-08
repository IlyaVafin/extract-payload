import fetchCookie from 'fetch-cookie';
import fetchBase, { RequestInit, Response } from 'node-fetch';
import { CookieJar } from 'tough-cookie';
import fs from 'fs';
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

export interface WorkExperience {
  position: string;
  companyName: string;
  employmentType: string;
  period: string;
  location: string;
  logoUrl: string;
}

export function parseLinkedInExperience(rawContent: string): WorkExperience[] {
  const logoMap: Record<string, string> = {};
  const companyNamesSet = new Set<string>();

  // === 1. Извлекаем логотипы и гарантированно получаем чистые названия компаний ===
  const a11yRegex =
    /"a11yText"\s*:\s*"(?:Эмблема организации|Company logo for)\s*([^"]+)"/g;
  let matchA11y;
  while ((matchA11y = a11yRegex.exec(rawContent)) !== null) {
    const company = matchA11y[1].trim();
    companyNamesSet.add(company);

    const chunk = rawContent.substring(matchA11y.index, matchA11y.index + 1500);
    const rootMatch = chunk.match(/"rootUrl"\s*:\s*"([^"]+)"/);
    const rendMatch = chunk.match(/"imageRenditions"\s*:\s*\[(.*?)\]/);

    if (rootMatch && rendMatch) {
      const rootUrl = rootMatch[1];
      const renditions = rendMatch[1];
      const suffixes = [
        ...renditions.matchAll(/"suffixUrl"\s*:\s*"([^"]+)"/g),
      ].map((x) => x[1]);
      const best =
        suffixes.find((s) => s.includes('200_200')) ||
        suffixes.find((s) => s.includes('100_100')) ||
        suffixes[0] ||
        '';
      logoMap[company] = best ? `${rootUrl}${best}` : 'Нет фото';
    } else {
      if (!logoMap[company]) logoMap[company] = 'Нет фото';
    }
  }

  // Названия компаний в разделе связей с навыками — для бэкапа без картинок
  const skillsRegexRu = /"Навыки для должности «[^»]+ в организации ([^»]+)»"/g;
  let skMatch;
  while ((skMatch = skillsRegexRu.exec(rawContent)) !== null) {
    companyNamesSet.add(skMatch[1].trim());
  }
  const skillsRegexEn = /"Skills for .*? at ([^"]+)"/g;
  while ((skMatch = skillsRegexEn.exec(rawContent)) !== null) {
    companyNamesSet.add(skMatch[1].trim());
  }

  // === 2. Вспомогательные функции, спасающие склеивания типа «Apple · Contract» ===
  const isCompany = (s: string) => {
    const text = s.trim();
    if (companyNamesSet.has(text)) return true;
    if (text.includes('·')) {
      const companyPart = text.split('·')[0].trim();
      if (companyNamesSet.has(companyPart)) return true;
    }
    return false;
  };

  const getCompanyBase = (s: string) => {
    if (s.includes('·')) {
      return s.split('·')[0].trim();
    }
    return s.trim();
  };

  // === 3. Собираем массив только чистых строковых параметров интерфейса ===
  const allTexts: string[] = [];
  const textRegex = /"children"\s*:\s*\[\s*"((?:[^"\\]|\\.)*)"\s*\]/g;
  let matchText;
  while ((matchText = textRegex.exec(rawContent)) !== null) {
    let text = matchText[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim();

    // Блокируем парсинг многострочных массивов текста с обязанностями и ID переменных
    if (text.includes('\\n') || text.includes('\n') || text.length > 150)
      continue;
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
      allTexts.push(text);
    }
  }

  const startIndex = allTexts.findIndex(
    (t) => t === 'Опыт работы' || t === 'Experience',
  );
  const stopWords = [
    'Образование',
    'Education',
    'Лицензии и сертификаты',
    'Licenses & certifications',
    'Проекты',
    'Projects',
    'Опыт волонтерской работы',
    'Volunteer experience',
  ];
  let endIndex = allTexts.findIndex(
    (t, idx) => idx > startIndex && stopWords.includes(t),
  );
  if (endIndex === -1) endIndex = allTexts.length;

  const expTexts =
    startIndex !== -1 ? allTexts.slice(startIndex + 1, endIndex) : allTexts;

  const isPositionPeriod = (s: string) => {
    if (!s.includes('–') && !s.includes('-')) return false;
    if (/мес|г\.|год|лет|настоящее время|present|mos|yrs|yr|mo|month/i.test(s))
      return true;
    if (/\b(19|20)\d{2}\s*[–-]\s*(19|20)\d{2}\b/.test(s)) return true;
    return false;
  };

  const isGroupPeriod = (s: string) => {
    if (s.includes('–') || s.includes('-')) return false;
    if (!/мес|г\.|год|лет|mos|yrs|yr|mo|month/i.test(s)) return false;
    return true;
  };

  const isEmploymentType = (s: string) => {
    const lower = s.toLowerCase();
    return /полный рабочий день|частичная занятость|contract|freelance|internship|self-employed|контракт|внештатный сотрудник|стажировка|самозанятость|сезонная работа|full-time|part-time/i.test(
      lower,
    );
  };

  // === 4. Парсим логически двигаясь вперёд ===
  const experiences: WorkExperience[] = [];
  let i = 0;

  while (i < expTexts.length) {
    if (
      ['Показать все', 'Скрыть', 'развернуть', 'свернуть'].includes(expTexts[i])
    ) {
      i++;
      continue;
    }

    // -------------------------------------
    // СТРУКТУРА 1: Одиночная должность в рамках компании
    // Выглядит как: i -> Должность | i+1 -> Компании(и занятость) | i+2 -> Период
    if (i + 1 < expTexts.length && isCompany(expTexts[i + 1])) {
      const position = expTexts[i];
      const companyRaw = expTexts[i + 1];
      const companyName = getCompanyBase(companyRaw);
      let empType = 'Не указан';

      if (companyRaw.includes('·')) {
        empType = companyRaw.split('·')[1].trim();
      }
      i += 2;

      let period = 'Не указан';
      if (i < expTexts.length && isPositionPeriod(expTexts[i])) {
        period = expTexts[i];
        i++;
      }

      let location = 'Не указана';
      // Если текущий кусок текста и его +1 не маркируются как начало следующего опыта - это Локация
      if (i < expTexts.length && !isCompany(expTexts[i])) {
        const isNextStartOfSingle =
          i + 1 < expTexts.length && isCompany(expTexts[i + 1]);
        if (
          !isNextStartOfSingle &&
          !['Показать все', 'Скрыть'].includes(expTexts[i])
        ) {
          location = expTexts[i];
          i++;
        }
      }

      experiences.push({
        position,
        companyName,
        employmentType: empType,
        period,
        location,
        logoUrl: logoMap[companyName] || 'Нет фото',
      });

      // -------------------------------------
      // СТРУКТУРА 2: Мульти-блок внутри единой организации
      // Выглядит как: i -> Название организации | далее её должности с датами друг за другом
    } else if (isCompany(expTexts[i])) {
      const companyName = getCompanyBase(expTexts[i]);
      i++;

      let groupEmpType = 'Не указан';
      let groupDuration = '';

      if (
        i < expTexts.length &&
        (expTexts[i].includes('·') || isGroupPeriod(expTexts[i]))
      ) {
        const parts = expTexts[i].split('·').map((s) => s.trim());
        if (parts.length === 2) {
          groupEmpType = parts[0];
          groupDuration = parts[1];
        } else if (parts.length === 1) {
          if (isGroupPeriod(parts[0])) groupDuration = parts[0];
          else groupEmpType = parts[0];
        }
        i++;
      }

      let groupLocation = 'Не указана';

      while (i < expTexts.length) {
        const isNextStartOfSingle =
          i + 1 < expTexts.length && isCompany(expTexts[i + 1]);
        if (isCompany(expTexts[i]) || isNextStartOfSingle) break;

        let p = i;
        while (p < expTexts.length && !isPositionPeriod(expTexts[p])) {
          if (
            isCompany(expTexts[p]) ||
            (p + 1 < expTexts.length && isCompany(expTexts[p + 1]))
          )
            break;
          p++;
        }

        if (p >= expTexts.length || !isPositionPeriod(expTexts[p])) break;

        const N = p - i;
        let pos = 'Не указана';
        let emp = groupEmpType;

        if (N === 1) pos = expTexts[i];
        else if (N === 2) {
          if (isEmploymentType(expTexts[p - 1])) {
            pos = expTexts[i];
            emp = expTexts[p - 1];
          } else {
            if (groupLocation === 'Не указана') groupLocation = expTexts[i];
            pos = expTexts[p - 1];
          }
        } else if (N >= 3) {
          if (groupLocation === 'Не указана') groupLocation = expTexts[i];
          pos = expTexts[p - 2];
          emp = expTexts[p - 1];
        }

        const period = expTexts[p];
        i = p + 1;

        let location = groupLocation;
        if (i < expTexts.length) {
          const isLookingNewNode =
            isCompany(expTexts[i]) ||
            (i + 1 < expTexts.length && isCompany(expTexts[i + 1]));
          if (
            !isLookingNewNode &&
            !['Показать все', 'Скрыть'].includes(expTexts[i])
          ) {
            location = expTexts[i];
            i++;
          }
        }

        experiences.push({
          position: pos,
          companyName,
          employmentType: emp,
          period,
          location,
          logoUrl: logoMap[companyName] || 'Нет фото',
        });
      }
    } else {
      i++;
    }
  }

  return experiences;
}

const linkedIn = new LinkedInProfileCardsBelowActivityClient();
linkedIn
  .postProfileCardsBelowActivity({
    cookie:
      'bcookie="v=2&0bff0c56-5f68-44ef-8530-9b087162b5cd"; bscookie="v=1&2025121307340691143906-79e0-47d2-8ec9-da7ef5f039b6AQGUdUbRCwoxZNQ0om8uuaDZ9rjNI7dV"; li_alerts=e30=; li_gc=MTsyMTsxNzY2ODQzMzk4OzI7MDIxvo25DqkPC857BEio9Bt1+63x5PRJqy/hKEt02UTQl40=; li_theme=light; li_theme_set=app; dfpfpt=d0b881af6df348b0b74f9b71879abbd5; _pxvid=d7dee901-e32a-11f0-967d-bc8e2be6d821; aam_uuid=05823511190603889814147778553090456797; timezone=Europe/Moscow; gpv_pn=developer.linkedin.com%2Fproduct-catalog; s_tp=5751; _uetvid=d1d0866001ad11f1944a97ff33bbda45; mbox=PC#77e9a1d9ae4c4141aa9e4aa4b3f4f836.37_0#1794666480|session#8a8d2e3177234eb99e4c3447b1923772#1779116340; s_ips=911; s_tslv=1779114481584; visit=v=1&M; _gcl_au=1.1.961100378.1774812283.308313686.1779809921.1779809946; fid=AQFjfo6GH5VaeAAAAZ6JGZGvuqSCJN2rObpI_3VTl_-CXlbZACqGsUhajT5gvqkRqrl-II0JKZbIyg; g_state={"i_l":0}; li_rm=AQF2-NcUBiGsbAAAAZ6MiSHsXpak3bMoJ61Hj0TadOIPAURXkhKM9ntBmWgFWjcNo0nDyZBaVNcijPU5HBo2NSsWx-Y5ljx8Y0Xg0NCGh8LHnVddGqNaEau-lISIfy9-QFv0_Rr4qTRG3DwOLhZDGmUq7cJMLRWBj7eI35N5nAQIRVzTjpfZtt1Qfs1ZZxsvlOdesY5FaMqDLeSkrZ6KM2FumW8UqPn5DgrAUFb_1yTEU6IZbVUogph9E6OfdZ-b6I2JtGRXlHpIkJPW8p4ltbNP2XVgFfxh9KKQ1ALrOVC7XKLME_yqH7YCxKRoApUxPWrQ3PPCt_MaDhhkR3rgBw; liap=true; li_at=AQEDAWQo7A0EMEjUAAABnoyJIcgAAAGesJWlyFYAVoTMWnqhahT_7vom9AUophehHgZnVVK6zXQSAdbDpb5ylB30XiPbng3B7Rbf6QEl6DlgXUqmc1s_LwyiMVYK3ACswSii_SNq0T25PmTZuHv7TNEr; JSESSIONID="ajax:3380652305041475523"; sdui_ver=sdui-flagship:0.1.42269+SduiFlagship0; lidc="b=VB69:s=V:r=V:a=V:p=V:g=5252:u=10:x=1:i=1780837246:t=1780923646:v=2:sig=AQFfiPTBXTYDo5MeN6UQ2sW_Ve-S4rU5"; fptctx2=AQHF200J5AYuaecq7OhCQyUDFxiSazlUOLQ2xR%252fiIAw6xqD0LnNFred5xA21ESgl0Y%252f4C325DCtN1vEvGbeaj8oAeY%252fvNW7S5Xo%252fN5njpbppe%252fUrsNo1JF297BCryJiQ13Wdi1dVRSr%252br9WgCRfPPgH3GYDdYkyaj4txgbrPiJjh1%252fL1XYnrmeruiUuJdJTtGqvObPsergxgtFbymdop%252bTgGE0YtxkjgDNNdjwlFYCxeOdhKkmivCNq6E5QyO0pXJifkZ3v2Sz0RAyr4K01B4Gh0S%252fO5OJe%252fYgpFZT%252bccfwtdZy2AcS3UhNgzvyu1K57Ibw5fo2B6waiU%252fW5IxrhFElUn0y7ybF99XnE0hofZNSVmtmL5W7F%252bMuhuYHgji%252bOnkE%253d; AMCVS_14215E3D5995C57C0A495C55%40AdobeOrg=1; AMCV_14215E3D5995C57C0A495C55%40AdobeOrg=-637568504%7CMCIDTS%7C20612%7CMCMID%7C06383176159209553264125562938956336918%7CMCAAMLH-1781443282%7C6%7CMCAAMB-1781443282%7CRKhpRz8krg2tLO6pguXWp5olkAcUniQYPHaMWWgdJ3xzPWQmdj0y%7CMCOPTOUT-1780845682s%7CNONE%7CvVersion%7C5.1.1%7CMCCIDH%7C1117101140; PLAY_LANG=ru; lang=v=2&lang=ru-RU; PLAY_SESSION=eyJhbGciOiJIUzI1NiJ9.eyJkYXRhIjp7InNlc3Npb25faWQiOiIwYmQ2NThjYS1mYmRhLTRjZWMtYWIzYy02NzE4NGI3MmMyMmV8MTc4MDgzOTYzNyIsImFsbG93bGlzdCI6Int9IiwicmVjZW50bHktc2VhcmNoZWQiOiIiLCJyZWZlcnJhbC11cmwiOiJodHRwczovL3d3dy5saW5rZWRpbi5jb20vaGVscC9saW5rZWRpbi9hbnN3ZXIvYTEzNTc5MDY_bGFuZz1ydSIsInJlY2VudGx5LXZpZXdlZCI6IiIsIkNQVC1pZCI6IsKpairCsMOQXHUwMDAxQsKZJcKDw65APFx1MDAxOXV7IiwiZXhwZXJpZW5jZSI6IiIsInRyayI6IiJ9LCJuYmYiOjE3ODA4Mzk2MzcsImlhdCI6MTc4MDgzOTYzN30.AyVACvodN9K-PQ-adt_jn8Y0RllxPJ4xgJFKw419MGc; li_mc=MTsyMTsxNzgwODU1MTE3OzE7MDIxzr1XNdynf+Bef8N2dPEuj00UASj1s7y+5nmGHcVFflM=; __cf_bm=F5eCgLButbbM3MAMjSvyWfcKa8CtWIPp9AcS38IP0to-1780855184.8501225-1.0.1.1-UNMqL30zpQEUbu8VLYUO7.S0a8xfQM4JP4O96dSF.vcpP4XgprsNW6WZoFk7cM7ih6NqLAAZq9gPY62FSgYHtMKqOPBqFNGBjCOJ0xte5842eS_qPkr4gAPeWxRlG5_e; UserMatchHistory=AQLqnmLcRLxvcAAAAZ6jPsTPUwaQYRGHYaX-m6RCB5AO8reoxin-eB9fRi3zhHLf21bXx0RqbYSJpULP8jEf-VgboLvWQF3FmT44FQ2UCvFUSEq2Y3qdW9ERiuK0xV6sVWZszuMzzAB2P7PrgeGSb0_jFkdMnIFsWA8n3XZLMoV0S-lwMymucoml1K-swIWW8F9Lcp2yDbVQWBdoI-9ZPHwBlcckxBFLYAdP1LgHoRhonamTCaKvFnXmqZ7RtCF2_upICxzh2lA26ruSZ7YxCQ4al_g4ymAd1f2dkgtoN-6jGXvNCS4B0to6TOxH6yGu_sh_wd_BFy9CZXhRUtBUHKrYdfNZBeTAEqG0eSZ12XoSuNVPtg',
    vanityName: 'ben-barr-7356a9bb',
    vieweeProfileId: 'ACoAABmNotkBK1YD87eASNSoNQNmpMSEqP8KO8w',
  })
  .then((res) => {
    fs.writeFileSync('raw.txt', res.raw);
    const experience = parseLinkedInExperience(res.raw);
    console.log(experience);
  })
  .catch((err) => {
    console.error(err);
  });
