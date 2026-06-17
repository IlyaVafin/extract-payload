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

// const l = new LinkedInProfileAbout();
// l.postProfileCardsAbout({ cookie: '', vanityName: '', vieweeProfileId: '' }).then((res) => {
//   const about = parseLinkedInAbout(res.raw);
//   console.log(about);
// }

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

export async function fetchLinkedInProfileHtml(params: {
  vanityName: string;
  cookie: string;
  signal?: AbortSignal;
}) {
  const { vanityName, cookie, signal } = params;

  const url = `${DEFAULT_BASE_URL}/in/${vanityName}/`;

  const response = await fetch(url, {
    method: 'GET',
    signal,
    headers: {
      Cookie: cookie,
    },
  });

  const html = await response.text();

  if (!response.ok) {
    const snippet = html.slice(0, 500);
    throw new Error(
      `LinkedIn profile fetch failed: ${response.status}\n${snippet}`,
    );
  }

  return {
    html,
  };
}

function parseLinkedInLocation(html: string): string | null {
  // Способ 1: Поиск в JSON-подобных данных (rehydration data)
  // Ищем массив children, в котором лежит строка с запятой (типично для локации)
  // Исключаем строки, начинающиеся на $ (технические переменные)
  const jsonRegex = /"children"\s*:\s*\[\s*"([^$][^"]+?,\s*[^"]+?)"\s*\]/g;
  let match;

  while ((match = jsonRegex.exec(html)) !== null) {
    const candidate = match[1].trim();
    // Локация обычно не очень длинная и содержит запятую
    if (candidate.length < 100 && candidate.includes(',')) {
      return candidate;
    }
  }

  // Способ 2: Поиск через специфический класс в HTML (Fallback)
  // В вашем файле локация лежит в <p> с классом, содержащим '_354585b3'
  const htmlMatch = html.match(/<p[^>]*?_354585b3[^>]*?>(.*?)<\/p>/);
  if (htmlMatch && htmlMatch[1]) {
    return htmlMatch[1].trim();
  }

  return null;
}

fetchLinkedInProfileHtml({
  cookie:
    'bcookie="v=2&0bff0c56-5f68-44ef-8530-9b087162b5cd"; bscookie="v=1&2025121307340691143906-79e0-47d2-8ec9-da7ef5f039b6AQGUdUbRCwoxZNQ0om8uuaDZ9rjNI7dV"; li_alerts=e30=; li_gc=MTsyMTsxNzY2ODQzMzk4OzI7MDIxvo25DqkPC857BEio9Bt1+63x5PRJqy/hKEt02UTQl40=; li_theme=light; li_theme_set=app; dfpfpt=d0b881af6df348b0b74f9b71879abbd5; _pxvid=d7dee901-e32a-11f0-967d-bc8e2be6d821; aam_uuid=05823511190603889814147778553090456797; timezone=Europe/Moscow; gpv_pn=developer.linkedin.com%2Fproduct-catalog; s_tp=5751; _uetvid=d1d0866001ad11f1944a97ff33bbda45; mbox=PC#77e9a1d9ae4c4141aa9e4aa4b3f4f836.37_0#1794666480|session#8a8d2e3177234eb99e4c3447b1923772#1779116340; s_ips=911; s_tslv=1779114481584; visit=v=1&M; _gcl_au=1.1.961100378.1774812283.308313686.1779809921.1779809946; fid=AQFjfo6GH5VaeAAAAZ6JGZGvuqSCJN2rObpI_3VTl_-CXlbZACqGsUhajT5gvqkRqrl-II0JKZbIyg; g_state={"i_l":0}; li_rm=AQF2-NcUBiGsbAAAAZ6MiSHsXpak3bMoJ61Hj0TadOIPAURXkhKM9ntBmWgFWjcNo0nDyZBaVNcijPU5HBo2NSsWx-Y5ljx8Y0Xg0NCGh8LHnVddGqNaEau-lISIfy9-QFv0_Rr4qTRG3DwOLhZDGmUq7cJMLRWBj7eI35N5nAQIRVzTjpfZtt1Qfs1ZZxsvlOdesY5FaMqDLeSkrZ6KM2FumW8UqPn5DgrAUFb_1yTEU6IZbVUogph9E6OfdZ-b6I2JtGRXlHpIkJPW8p4ltbNP2XVgFfxh9KKQ1ALrOVC7XKLME_yqH7YCxKRoApUxPWrQ3PPCt_MaDhhkR3rgBw; liap=true; li_at=AQEDAWQo7A0EMEjUAAABnoyJIcgAAAGesJWlyFYAVoTMWnqhahT_7vom9AUophehHgZnVVK6zXQSAdbDpb5ylB30XiPbng3B7Rbf6QEl6DlgXUqmc1s_LwyiMVYK3ACswSii_SNq0T25PmTZuHv7TNEr; JSESSIONID="ajax:3380652305041475523"; sdui_ver=sdui-flagship:0.1.42269+SduiFlagship0; lidc="b=VB69:s=V:r=V:a=V:p=V:g=5252:u=10:x=1:i=1780837246:t=1780923646:v=2:sig=AQFfiPTBXTYDo5MeN6UQ2sW_Ve-S4rU5"; fptctx2=AQHF200J5AYuaecq7OhCQyUDFxiSazlUOLQ2xR%252fiIAw6xqD0LnNFred5xA21ESgl0Y%252f4C325DCtN1vEvGbeaj8oAeY%252fvNW7S5Xo%252fN5njpbppe%252fUrsNo1JF297BCryJiQ13Wdi1dVRSr%252br9WgCRfPPgH3GYDdYkyaj4txgbrPiJjh1%252fL1XYnrmeruiUuJdJTtGqvObPsergxgtFbymdop%252bTgGE0YtxkjgDNNdjwlFYCxeOdhKkmivCNq6E5QyO0pXJifkZ3v2Sz0RAyr4K01B4Gh0S%252fO5OJe%252fYgpFZT%252bccfwtdZy2AcS3UhNgzvyu1K57Ibw5fo2B6waiU%252fW5IxrhFElUn0y7ybF99XnE0hofZNSVmtmL5W7F%252bMuhuYHgji%252bOnkE%253d; AMCVS_14215E3D5995C57C0A495C55%40AdobeOrg=1; AMCV_14215E3D5995C57C0A495C55%40AdobeOrg=-637568504%7CMCIDTS%7C20612%7CMCMID%7C06383176159209553264125562938956336918%7CMCAAMLH-1781443282%7C6%7CMCAAMB-1781443282%7CRKhpRz8krg2tLO6pguXWp5olkAcUniQYPHaMWWgdJ3xzPWQmdj0y%7CMCOPTOUT-1780845682s%7CNONE%7CvVersion%7C5.1.1%7CMCCIDH%7C1117101140; PLAY_LANG=ru; lang=v=2&lang=ru-RU; PLAY_SESSION=eyJhbGciOiJIUzI1NiJ9.eyJkYXRhIjp7InNlc3Npb25faWQiOiIwYmQ2NThjYS1mYmRhLTRjZWMtYWIzYy02NzE4NGI3MmMyMmV8MTc4MDgzOTYzNyIsImFsbG93bGlzdCI6Int9IiwicmVjZW50bHktc2VhcmNoZWQiOiIiLCJyZWZlcnJhbC11cmwiOiJodHRwczovL3d3dy5saW5rZWRpbi5jb20vaGVscC9saW5rZWRpbi9hbnN3ZXIvYTEzNTc5MDY_bGFuZz1ydSIsInJlY2VudGx5LXZpZXdlZCI6IiIsIkNQVC1pZCI6IsKpairCsMOQXHUwMDAxQsKZJcKDw65APFx1MDAxOXV7IiwiZXhwZXJpZW5jZSI6IiIsInRyayI6IiJ9LCJuYmYiOjE3ODA4Mzk2MzcsImlhdCI6MTc4MDgzOTYzN30.AyVACvodN9K-PQ-adt_jn8Y0RllxPJ4xgJFKw419MGc; UserMatchHistory=AQI6qXft-1QeXQAAAZ6ixYQugN8GPV5HmN3W3Tii8nnLIThTqnQb6XRgGSWMB-lb6DNAdToN9FSPG2HzA16NQ4OhLf1C1lESVWtFwecGOZDgFOjhqIaHQNvC8FfKL7tezBEIbCG6vupFhbrfpdx_dooAIIWO4uFouQXiTw8tRk1wqMThoxUlek06f653PAmvcsyeWwwv6vU7k8YAbQHgIIE31Vp6Mr2PEEqZzW3ByeifIPrbC9Ajzt9jA_pcGZDazIWfXhvnij0llJ97V--UFEPMwlnHRbMNzFjaQE7_ySnqPVmpF8ce3PtGc84kYpsHYwvS2I4H61I0-f8DOM5PrgnskOCwXThcZVg0Y-xHu9xYWHSKMA; __cf_bm=VUmLam5ODUR6Cm56POxKeox9VCznHkaAFi8HXHJkMII-1780848189.858513-1.0.1.1-lY5e_9j1UTLYCrunAMYk.0pIBvdNRamyBH.JY8RfAsIlH9io0F.ui9.Uxk.0a8sOwCprRLMt9...5Omba8trimZJGTa3UTJ.QDlfKOLfaaoWCDZhYuABiAG8Axlry9o6; li_mc=MTsyMTsxNzgwODQ4ODIzOzE7MDIxb5POL4qFOd3fTlpRG5TiCjP6i43ePcWsv4cFsGOMpC8=',
  vanityName: 'vitaliikotlov',
})
  .then((res) => {
    const location = parseLinkedInLocation(res.html);
    console.log(location);
  })
  .catch((err) => {
    console.error('Error fetching LinkedIn profile:', err);
  });
