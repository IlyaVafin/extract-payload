import fetchCookie from 'fetch-cookie';
import fetchBase, { RequestInit, Response } from 'node-fetch';
import { CookieJar } from 'tough-cookie';

interface ProfileAbout {
  description: string;
  firstName: string;
  lastName: string;
}

function parseLinkedInAbout(rawContent: string): ProfileAbout {
  let description = '';

  // 1. Извлечение описания
  const formatAMatch = rawContent.match(
    /[a-z]:T[a-zA-Z0-9]+,([\s\S]*?)(?=\s*\d+\s*:\s*(?:\[|null|{)|$)/,
  );
  const descA = formatAMatch ? formatAMatch[1].trim() : '';

  const formatBRegex =
    /"textProps"[\s\S]*?"children"\s*:\s*\[\s*"((?:[^"\\]|\\.)*)"\s*\]/g;
  let descB = '';
  let match;
  let maxLen = 0;

  while ((match = formatBRegex.exec(rawContent)) !== null) {
    const foundText = match[1].replace(/\\n/g, '\n').trim();
    if (foundText.startsWith('$')) continue;

    if (foundText.length > maxLen) {
      maxLen = foundText.length;
      descB = foundText;
    }
  }

  description = descB.length > descA.length ? descB : descA;

  // 2. Извлечение имени (givenName) и фамилии (familyName)
  const givenNameMatch = rawContent.match(/"givenName"\s*:\s*"([^"]+)"/);
  const familyNameMatch = rawContent.match(/"familyName"\s*:\s*"([^"]+)"/);

  const firstName = givenNameMatch ? givenNameMatch[1] : '';
  const lastName = familyNameMatch ? familyNameMatch[1] : '';

  return {
    firstName,
    lastName,
    description,
  };
}

function parseLinkedInSkills(rawContent: string): string[] {
  const skills = new Set<string>();

  const visualSkillRegex =
    /"fontWeight"\s*:\s*"bold"[^}]*?"children"\s*:\s*\[\s*"([^"]+)"\s*\]/g;

  let match;
  while ((match = visualSkillRegex.exec(rawContent)) !== null) {
    const skill = match[1].trim();
    if (skill) {
      skills.add(skill);
    }
  }

  const metaSkillRegex = /"skillName"\s*:\s*"([^"]+)"/g;

  while ((match = metaSkillRegex.exec(rawContent)) !== null) {
    const skill = match[1].trim();
    if (skill) {
      skills.add(skill);
    }
  }

  return Array.from(skills);
}

interface EducationEntry {
  schoolName: string;
  degree: string;
  period: string;
  url: string | null;
}

function parseLinkedInEducation(rawContent: string): EducationEntry[] {
  // 1. Вырезаем секцию образования
  const educationSectionMatch = rawContent.match(
    /EducationTopLevelSection[\s\S]*?(?=CertificationTopLevel|Projects|$)/,
  );

  if (!educationSectionMatch) return [];
  const sectionText = educationSectionMatch[0];

  // 2. Разбиваем на блоки по ключевым словам, которые разделяют записи
  const blocks = sectionText.split(
    /education-lockup-view|componentKey|education_lockup/g,
  );

  const results: EducationEntry[] = [];

  for (const block of blocks) {
    // Извлекаем тексты, ИГНОРИРУЯ строки, начинающиеся с "$" или "$L"
    const textRegex = /"children"\s*:\s*\[\s*"([^$][^"]+?)"/g;
    const texts: string[] = [];
    let match;

    while ((match = textRegex.exec(block)) !== null) {
      const t = match[1].trim();
      // Убираем заголовки и слишком короткий мусор
      if (t.length > 2 && !/Образование|Education|Показать все/i.test(t)) {
        texts.push(t);
      }
    }

    // Ищем ссылку на школу или компанию
    const urlMatch = block.match(
      /"url"\s*:\s*"(https:\/\/www\.linkedin\.com\/(school|company)\/[^"]+)"/,
    );
    const url = urlMatch ? urlMatch[1] : null;

    if (texts.length > 0) {
      const dateRegex = /([а-я]{3,}\.?\s\d{4}|\d{4}\s*[–-]\s*\d{4})/i;
      const periodIndex = texts.findIndex((t) => dateRegex.test(t));

      let schoolName = texts[0];
      let degree = 'Не указано';
      let period = 'Не указан';

      if (periodIndex !== -1) {
        // Если нашли дату, то школа обычно за 2 элемента до неё, а степень за 1
        period = texts[periodIndex];
        schoolName = texts[periodIndex - 2] || texts[0];
        degree = texts[periodIndex - 1] || 'Не указано';
      } else {
        // Если даты нет (как у Rolling Scopes), берем первые два элемента
        schoolName = texts[0];
        degree = texts[1] || 'Не указано';
      }

      // Финальная проверка: имя школы не должно быть системным кодом
      if (schoolName && schoolName.length > 3 && !schoolName.startsWith('$')) {
        results.push({ schoolName, degree, period, url });
      }
    }
  }

  // Удаляем дубликаты по названию школы
  return results.filter(
    (entry, index, self) =>
      index === self.findIndex((t) => t.schoolName === entry.schoolName),
  );
}

type FetchFunction = (url: string, init?: RequestInit) => Promise<Response>;
const nodeFetch: FetchFunction = (url, init) => fetchBase(url, init);
const fetch = fetchCookie<string, RequestInit, Response>(
  nodeFetch,
  new CookieJar(),
) as FetchFunction;

const DEFAULT_BASE_URL = 'https://www.linkedin.com';

// ---------------------------------------------------------------------------
// Base class — общая логика для всех LinkedIn-клиентов
// ---------------------------------------------------------------------------

abstract class LinkedInBaseClient {
  protected readonly baseURL = DEFAULT_BASE_URL.replace(/\/+$|$/g, '');

  protected extractCsrfFromCookie(cookie: string): string {
    const match = cookie.match(/JSESSIONID="([^"]+)"/);
    if (!match) {
      throw new Error('No JSESSIONID found in cookie');
    }
    return match[1];
  }

  protected async warmSession(cookie: string): Promise<void> {
    await fetch(`${this.baseURL}/feed`, {
      headers: { Cookie: cookie },
    });
  }

  protected async postJSON(
    url: string,
    params: {
      cookie: string;
      body: unknown;
      referer: string;
      signal?: AbortSignal;
    },
  ): Promise<string> {
    const { cookie, body, referer, signal } = params;
    const csrf = this.extractCsrfFromCookie(cookie);

    const response = await fetch(url, {
      method: 'POST',
      signal,
      headers: {
        Cookie: cookie,
        'csrf-token': csrf,
        'content-type': 'application/json',
        accept: '*/*',
        origin: this.baseURL,
        referer,
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

    return raw;
  }

  protected buildBinding(key: string) {
    return {
      type: 'com.linkedin.sdui.components.core.BindingImpl',
      value: {
        key,
        namespace: 'MemoryNamespace',
      },
    };
  }
}

// ---------------------------------------------------------------------------

export interface ProfileEducationRequestParams {
  cookie: string;
  vanityName: string;
  isSelfView?: boolean;
  signal?: AbortSignal;
  referer?: string;
}

export interface ProfileCardsAboveActivityResponse {
  raw: string;
}

const PROFILE_EDUCATION_ACTIVITY_PATH =
  '/flagship-web/rsc-action/actions/component?componentId=com.linkedin.sdui.generated.profile.dsl.impl.profileCardsBelowActivityPart1&sduiid=com.linkedin.sdui.generated.profile.dsl.impl.profileCardsBelowActivityPart1&parentSpanId=L9kFXy3lfmg%3D';

export class LinkedInProfileEducation extends LinkedInBaseClient {
  private endpointURL(): string {
    return `${this.baseURL}${PROFILE_EDUCATION_ACTIVITY_PATH}`;
  }

  private buildRequestBody(params: {
    vanityName: string;
    isSelfView: boolean;
  }) {
    const { vanityName, isSelfView } = params;

    return {
      clientArguments: {
        payload: {
          isSelfView,
          vanityName,
          profileComponentState: {
            profileId: vanityName,
            shouldRefreshScreenOnReappear: this.buildBinding(
              `ProfileComponentStateShouldRefreshScreen${vanityName}ProfileComponentState`,
            ),
            shouldFetchFromCache: this.buildBinding(
              `ProfileComponentStateFetchFromCache${vanityName}ProfileComponentState`,
            ),
            shouldDisplayStickyHeader: this.buildBinding(
              `ProfileComponentStateShouldDisplayStickyHeader${vanityName}ProfileComponentState`,
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

  async postProfileEducation(
    params: ProfileEducationRequestParams,
  ): Promise<ProfileCardsAboveActivityResponse> {
    const { cookie, vanityName, isSelfView = false, referer, signal } = params;

    await this.warmSession(cookie);

    const raw = await this.postJSON(this.endpointURL(), {
      cookie,
      body: this.buildRequestBody({ vanityName, isSelfView }),
      referer: referer ?? `${this.baseURL}/in/${vanityName}/`,
      signal,
    });

    return { raw };
  }
}

// ---------------------------------------------------------------------------

const PROFILE_ABOUT_ACTIVITY_PATH =
  '/flagship-web/rsc-action/actions/component?componentId=com.linkedin.sdui.generated.profile.dsl.impl.profileCardsAboveActivity&sduiid=com.linkedin.sdui.generated.profile.dsl.impl.profileCardsAboveActivity&parentSpanId=gdFeVVEQRFA%3D';

export interface ProfileCardsAboveActivityRequestParams {
  cookie: string;
  vanityName: string;
  vieweeProfileId: string;
  isSelfView?: boolean;
  signal?: AbortSignal;
  referer?: string;
}

export class LinkedInProfileAbout extends LinkedInBaseClient {
  private endpointURL(): string {
    return `${this.baseURL}${PROFILE_ABOUT_ACTIVITY_PATH}`;
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

  async postProfileCardsAbout(
    params: ProfileCardsAboveActivityRequestParams,
  ): Promise<ProfileCardsAboveActivityResponse> {
    const {
      cookie,
      vanityName,
      vieweeProfileId,
      isSelfView = false,
      referer,
      signal,
    } = params;

    await this.warmSession(cookie);

    const raw = await this.postJSON(this.endpointURL(), {
      cookie,
      body: this.buildRequestBody({ vanityName, vieweeProfileId, isSelfView }),
      referer: referer ?? `${this.baseURL}/in/${vanityName}/`,
      signal,
    });

    return { raw };
  }
}

// ---------------------------------------------------------------------------

export class LinkedInProfileSkills extends LinkedInBaseClient {
  private endpointURL(): string {
    return `${this.baseURL}/flagship-web/rsc-action/actions/pagination?sduiid=com.linkedin.sdui.pagers.profile.details.skills`;
  }

  private buildRequestBody(params: { vanityName: string; profileId: string }) {
    const { vanityName, profileId } = params;

    const payload = {
      start: 0,
      count: 100,
      vanityName,
      profileId,
      filter: 'ProfileSkillCategory_ALL',
    };

    return {
      pagerId: 'com.linkedin.sdui.pagers.profile.details.skills',

      clientArguments: {
        $type: 'proto.sdui.actions.requests.RequestedArguments',
        payload,
        requestedStateKeys: [],
        requestMetadata: {
          $type: 'proto.sdui.common.RequestMetadata',
        },
        states: [],
        screenId: 'com.linkedin.sdui.flagshipnav.profile.ProfileSkillDetails',
      },

      paginationRequest: {
        $type: 'proto.sdui.actions.requests.PaginationRequest',
        pagerId: 'com.linkedin.sdui.pagers.profile.details.skills',

        requestedArguments: {
          $type: 'proto.sdui.actions.requests.RequestedArguments',
          payload,
          requestedStateKeys: [],
          requestMetadata: {
            $type: 'proto.sdui.common.RequestMetadata',
          },
        },

        trigger: {
          $case: 'itemDistanceTrigger',
          itemDistanceTrigger: {
            $type: 'proto.sdui.actions.requests.ItemDistanceTrigger',
            preloadDistance: 3,
            preloadLength: 250,
          },
        },

        retryCount: 2,
      },
    };
  }

  async getSkills(params: {
    cookie: string;
    vanityName: string;
    profileId: string;
    referer?: string;
    signal?: AbortSignal;
  }): Promise<{ raw: string }> {
    const { cookie, vanityName, profileId, referer, signal } = params;

    await this.warmSession(cookie);

    const raw = await this.postJSON(this.endpointURL(), {
      cookie,
      body: this.buildRequestBody({ vanityName, profileId }),
      referer: referer ?? `${this.baseURL}/in/${vanityName}/`,
      signal,
    });

    return { raw };
  }
}
