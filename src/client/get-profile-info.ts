import fs from 'fs';
import fetchCookie from 'fetch-cookie';
import fetchBase, { RequestInit, Response } from 'node-fetch';
import { CookieJar } from 'tough-cookie';
interface ProfileAbout {
  description: string;
  topSkills: string[];
}

function parseLinkedInAbout(rawContent: string): ProfileAbout {
  let description = '';
  let topSkills: string[] = [];
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

  const skillsRegex =
    /"(?:Основные навыки|Top Skills)"[\s\S]*?"children"\s*:\s*\[\s*"([^"]+)"\s*\]/;
  const skillsDataMatch = rawContent.match(skillsRegex);

  if (skillsDataMatch) {
    const skillsText = skillsDataMatch[1];
    topSkills = skillsText
      .split(/[•·,]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  return {
    description,
    topSkills,
  };
}

interface EducationEntry {
  schoolName: string;
  degree: string;
  period: string;
}

function parseLinkedInEducation(rawContent: string): EducationEntry[] {
  // 1. Находим секцию образования
  // Она начинается с EducationTopLevelSection и заканчивается перед следующей крупной секцией (например, CertificationTopLevel)
  const educationSectionMatch = rawContent.match(
    /EducationTopLevelSection[\s\S]*?(?=CertificationTopLevel|$)/,
  );

  if (!educationSectionMatch) {
    return [];
  }

  const sectionText = educationSectionMatch[0];

  // 2. Ищем все текстовые блоки внутри "children": ["Текст"]
  // В LinkedIn SDUI данные образования обычно идут в строгом порядке:
  // 1. Название заведения
  // 2. Описание (степень)
  // 3. Период
  const textRegex = /"children"\s*:\s*\[\s*"([^"]+)"\s*\]/g;
  const allTexts: string[] = [];
  let match;

  while ((match = textRegex.exec(sectionText)) !== null) {
    const text = match[1].trim();
    // Игнорируем технические заголовки и пустые строки
    if (text !== 'Образование' && text !== 'Education' && text.length > 0) {
      allTexts.push(text);
    }
  }

  // 3. Группируем найденные тексты в объекты
  const education: EducationEntry[] = [];

  // Перебираем массив, распознавая паттерны
  for (let i = 0; i < allTexts.length; i++) {
    // LinkedIn период обычно начинается с "С " или содержит даты через дефис/тире
    // Если текущий элемент похож на период, а предыдущие два были названием и описанием
    if (allTexts[i].match(/^(С\s\d|From\s\d|\d{4}–\d{4})/)) {
      education.push({
        schoolName: allTexts[i - 2] || 'Не указано',
        degree: allTexts[i - 1] || 'Не указано',
        period: allTexts[i],
      });
    }
  }

  return education;
}

type FetchFunction = (url: string, init?: RequestInit) => Promise<Response>;
const nodeFetch: FetchFunction = (url, init) => fetchBase(url, init);
const fetch = fetchCookie<string, RequestInit, Response>(
  nodeFetch,
  new CookieJar(),
) as FetchFunction;

const DEFAULT_BASE_URL = 'https://www.linkedin.com';

const PROFILE_EDUCATION_ACTIVITY_PATH =
  '/flagship-web/rsc-action/actions/component?componentId=com.linkedin.sdui.generated.profile.dsl.impl.profileCardsBelowActivityPart1&sduiid=com.linkedin.sdui.generated.profile.dsl.impl.profileCardsBelowActivityPart1&parentSpanId=L9kFXy3lfmg%3D';

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

export class LinkedInProfileCardsAboveActivityClient {
  private readonly baseURL = DEFAULT_BASE_URL.replace(/\/+$|$/g, '');

  private endpointURL(): string {
    return `${this.baseURL}${PROFILE_EDUCATION_ACTIVITY_PATH}`;
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

  private buildBinding(key: string) {
    return {
      type: 'com.linkedin.sdui.components.core.BindingImpl',
      value: {
        key,
        namespace: 'MemoryNamespace',
      },
    };
  }

  async postProfileCardsAboveActivity(
    params: ProfileEducationRequestParams,
  ): Promise<ProfileCardsAboveActivityResponse> {
    const { cookie, vanityName, isSelfView = false, referer, signal } = params;

    await this.warmSession(cookie);
    const csrf = this.extractCsrfFromCookie(cookie);

    const body = this.buildRequestBody({ vanityName, isSelfView });

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

// const linkedin = new LinkedInProfileCardsAboveActivityClient();
// linkedin
//   .postProfileCardsAboveActivity({
//     cookie:
//       'bcookie="v=2&0bff0c56-5f68-44ef-8530-9b087162b5cd"; bscookie="v=1&2025121307340691143906-79e0-47d2-8ec9-da7ef5f039b6AQGUdUbRCwoxZNQ0om8uuaDZ9rjNI7dV"; li_alerts=e30=; li_gc=MTsyMTsxNzY2ODQzMzk4OzI7MDIxvo25DqkPC857BEio9Bt1+63x5PRJqy/hKEt02UTQl40=; li_theme=light; li_theme_set=app; dfpfpt=d0b881af6df348b0b74f9b71879abbd5; _pxvid=d7dee901-e32a-11f0-967d-bc8e2be6d821; aam_uuid=05823511190603889814147778553090456797; timezone=Europe/Moscow; gpv_pn=developer.linkedin.com%2Fproduct-catalog; s_tp=5751; _uetvid=d1d0866001ad11f1944a97ff33bbda45; mbox=PC#77e9a1d9ae4c4141aa9e4aa4b3f4f836.37_0#1794666480|session#8a8d2e3177234eb99e4c3447b1923772#1779116340; s_ips=911; s_tslv=1779114481584; visit=v=1&M; _gcl_au=1.1.961100378.1774812283.308313686.1779809921.1779809946; fid=AQFjfo6GH5VaeAAAAZ6JGZGvuqSCJN2rObpI_3VTl_-CXlbZACqGsUhajT5gvqkRqrl-II0JKZbIyg; g_state={"i_l":0}; li_rm=AQF2-NcUBiGsbAAAAZ6MiSHsXpak3bMoJ61Hj0TadOIPAURXkhKM9ntBmWgFWjcNo0nDyZBaVNcijPU5HBo2NSsWx-Y5ljx8Y0Xg0NCGh8LHnVddGqNaEau-lISIfy9-QFv0_Rr4qTRG3DwOLhZDGmUq7cJMLRWBj7eI35N5nAQIRVzTjpfZtt1Qfs1ZZxsvlOdesY5FaMqDLeSkrZ6KM2FumW8UqPn5DgrAUFb_1yTEU6IZbVUogph9E6OfdZ-b6I2JtGRXlHpIkJPW8p4ltbNP2XVgFfxh9KKQ1ALrOVC7XKLME_yqH7YCxKRoApUxPWrQ3PPCt_MaDhhkR3rgBw; liap=true; li_at=AQEDAWQo7A0EMEjUAAABnoyJIcgAAAGesJWlyFYAVoTMWnqhahT_7vom9AUophehHgZnVVK6zXQSAdbDpb5ylB30XiPbng3B7Rbf6QEl6DlgXUqmc1s_LwyiMVYK3ACswSii_SNq0T25PmTZuHv7TNEr; JSESSIONID="ajax:3380652305041475523"; sdui_ver=sdui-flagship:0.1.42142+SduiFlagship0; lidc="b=VB69:s=V:r=V:a=V:p=V:g=5252:u=10:x=1:i=1780667479:t=1780753879:v=2:sig=AQEcugzPRcLTpBXsMcyt4aIj7Vyaoupx"; lang=v=2&lang=ru-ru; fptctx2=AQGZKve2TPRVvxacagIO3%252bElP0I8IEivJ3ivTtY%252fS40jGhpwdj2ZsuHQMZWTZucCC%252baK0cbzlNVDHCP0hYBr1AvaNzKUfrPbQ75AGJsXKHsrV3WFe37T8NoalOqgYubqeFZ7lKvnl0sf%252bIz%252fHevYGZrpOEjmptE%252bNhODf0kDkT%252bNKhMtCw5xxXk85NvHiTUxVE9cRZKrisCYv4dVBWdIjqyigk5Ojc86MjP0Yl0JxIQsdFKsJkoZGu%252bvn2P7tTVTvEMUlz9%252fvrxWaSUMuytrohWpD8BWEphkDTMKSFTUl5jIYjETr6GZbpXQdlXrzY3tMJfAsYUMsdnYfrxaNixHX7uVBfcjSG1kjeSACdhD572LEVMge8YlommgcwitUa%252bzc3o%253d; AMCVS_14215E3D5995C57C0A495C55%40AdobeOrg=1; AMCV_14215E3D5995C57C0A495C55%40AdobeOrg=-637568504%7CMCIDTS%7C20609%7CMCMID%7C06383176159209553264125562938956336918%7CMCAAMLH-1781276442%7C6%7CMCAAMB-1781276442%7CRKhpRz8krg2tLO6pguXWp5olkAcUniQYPHaMWWgdJ3xzPWQmdj0y%7CMCOPTOUT-1780678842s%7CNONE%7CvVersion%7C5.1.1%7CMCCIDH%7C1117101140; __cf_bm=Fq18sP8sPdixe8MbXo07QNEDAqcR5XwKFLiMgdEtUoQ-1780672644.0298758-1.0.1.1-HceHbp8cE47jNNDGfU80tDf1WPdM3CLrrufVvhvpW5bPGYc2j2383N6hqo_kgjo97e0rGqjYZTytA52irql3Vz2tAzKfDFRVhs9BgKV620EA2AcB..rD2IqQXLAAaCN1; li_mc=MTsyMTsxNzgwNjcyODAyOzI7MDIxMzpxqbIf8fbMYTfPIiIa2orjjOQEv2PKKrVGZBFIaZY=; UserMatchHistory=AQI2HCKF698_NAAAAZ6YX3L6kiSkdZvKDzPheZ2h1OGPo1DimDmNOFmcJB7V6mEdpHvLcGr_ZJIQuKCfjPColq1TkN6hbs36Bx1jip4UuLT1XIj7o5vmVVCy8-CEGPll_O3OBUNH0tAFNVrmh8lo2dbbQxEpBYTFB_ZD-1txbu8ipcX7TMkTgzA38ogeUmM8HHcRLs1wWgGww7I9grLg3J79b-f0WAvg1mbpZEBJyBcxP7KZ42OgQ5C_p7rFXs-oorPOmP6cZa_jMVxKg6kU7icX0IAGzK20NsgGOI-MUfke4RcshxJfo2EwhQnV05vGt5Vr21P1L6zppoFiFspNU__TpdZU7qqd4XxmVvRaY4qNr9VJEg',
//     vanityName: 'ben-barr-7356a9bb',
//   })
//   .then((data) => {
//     const parsedEducation = parseLinkedInEducation(data.raw);
//     console.log(parsedEducation);
//   })
//   .catch((err) => console.error(err));

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

export interface ProfileCardsAboveActivityResponse {
  raw: string;
}

export class LinkedInProfileAbout {
  private readonly baseURL = DEFAULT_BASE_URL.replace(/\/+$|$/g, '');

  private endpointURL(): string {
    return `${this.baseURL}${PROFILE_ABOUT_ACTIVITY_PATH}`;
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
      console.log(response);
      throw new Error(`linkedin: status ${response.status}: ${snippet}`);
    }

    return { raw };
  }
}

const linkedInAbout = new LinkedInProfileAbout();
linkedInAbout
  .postProfileCardsAbout({
    cookie:
      'bcookie="v=2&0bff0c56-5f68-44ef-8530-9b087162b5cd"; bscookie="v=1&2025121307340691143906-79e0-47d2-8ec9-da7ef5f039b6AQGUdUbRCwoxZNQ0om8uuaDZ9rjNI7dV"; li_alerts=e30=; li_gc=MTsyMTsxNzY2ODQzMzk4OzI7MDIxvo25DqkPC857BEio9Bt1+63x5PRJqy/hKEt02UTQl40=; li_theme=light; li_theme_set=app; dfpfpt=d0b881af6df348b0b74f9b71879abbd5; _pxvid=d7dee901-e32a-11f0-967d-bc8e2be6d821; aam_uuid=05823511190603889814147778553090456797; timezone=Europe/Moscow; gpv_pn=developer.linkedin.com%2Fproduct-catalog; s_tp=5751; _uetvid=d1d0866001ad11f1944a97ff33bbda45; mbox=PC#77e9a1d9ae4c4141aa9e4aa4b3f4f836.37_0#1794666480|session#8a8d2e3177234eb99e4c3447b1923772#1779116340; s_ips=911; s_tslv=1779114481584; visit=v=1&M; _gcl_au=1.1.961100378.1774812283.308313686.1779809921.1779809946; fid=AQFjfo6GH5VaeAAAAZ6JGZGvuqSCJN2rObpI_3VTl_-CXlbZACqGsUhajT5gvqkRqrl-II0JKZbIyg; g_state={"i_l":0}; li_rm=AQF2-NcUBiGsbAAAAZ6MiSHsXpak3bMoJ61Hj0TadOIPAURXkhKM9ntBmWgFWjcNo0nDyZBaVNcijPU5HBo2NSsWx-Y5ljx8Y0Xg0NCGh8LHnVddGqNaEau-lISIfy9-QFv0_Rr4qTRG3DwOLhZDGmUq7cJMLRWBj7eI35N5nAQIRVzTjpfZtt1Qfs1ZZxsvlOdesY5FaMqDLeSkrZ6KM2FumW8UqPn5DgrAUFb_1yTEU6IZbVUogph9E6OfdZ-b6I2JtGRXlHpIkJPW8p4ltbNP2XVgFfxh9KKQ1ALrOVC7XKLME_yqH7YCxKRoApUxPWrQ3PPCt_MaDhhkR3rgBw; liap=true; li_at=AQEDAWQo7A0EMEjUAAABnoyJIcgAAAGesJWlyFYAVoTMWnqhahT_7vom9AUophehHgZnVVK6zXQSAdbDpb5ylB30XiPbng3B7Rbf6QEl6DlgXUqmc1s_LwyiMVYK3ACswSii_SNq0T25PmTZuHv7TNEr; JSESSIONID="ajax:3380652305041475523"; sdui_ver=sdui-flagship:0.1.42142+SduiFlagship0; lidc="b=VB69:s=V:r=V:a=V:p=V:g=5252:u=10:x=1:i=1780667479:t=1780753879:v=2:sig=AQEcugzPRcLTpBXsMcyt4aIj7Vyaoupx"; lang=v=2&lang=ru-ru; fptctx2=AQGZKve2TPRVvxacagIO3%252bElP0I8IEivJ3ivTtY%252fS40jGhpwdj2ZsuHQMZWTZucCC%252baK0cbzlNVDHCP0hYBr1AvaNzKUfrPbQ75AGJsXKHsrV3WFe37T8NoalOqgYubqeFZ7lKvnl0sf%252bIz%252fHevYGZrpOEjmptE%252bNhODf0kDkT%252bNKhMtCw5xxXk85NvHiTUxVE9cRZKrisCYv4dVBWdIjqyigk5Ojc86MjP0Yl0JxIQsdFKsJkoZGu%252bvn2P7tTVTvEMUlz9%252fvrxWaSUMuytrohWpD8BWEphkDTMKSFTUl5jIYjETr6GZbpXQdlXrzY3tMJfAsYUMsdnYfrxaNixHX7uVBfcjSG1kjeSACdhD572LEVMge8YlommgcwitUa%252bzc3o%253d; AMCVS_14215E3D5995C57C0A495C55%40AdobeOrg=1; AMCV_14215E3D5995C57C0A495C55%40AdobeOrg=-637568504%7CMCIDTS%7C20609%7CMCMID%7C06383176159209553264125562938956336918%7CMCAAMLH-1781276442%7C6%7CMCAAMB-1781276442%7CRKhpRz8krg2tLO6pguXWp5olkAcUniQYPHaMWWgdJ3xzPWQmdj0y%7CMCOPTOUT-1780678842s%7CNONE%7CvVersion%7C5.1.1%7CMCCIDH%7C1117101140; UserMatchHistory=AQK4YbUzdJ6yzQAAAZ6YXASJ-6VVwojIGTuDkLMYv1rZp4P3t8PYPMYik609MPlAuIPbSHixWMVBaO31f05iud_NpvL_7ruePgXsMdS8dpX-ZELjkOCddkipPK1snv6fpnhsWDxxkhg3sIA-vQruvTLRRvb3ttOvewi35AG3Rhs_rA3kgHbmTByo5NNhMfd9ZYyGInOx4AZa20kViHvHAAf9G88_EALb9IoA3KcgDXnlM1gNDJSmTK-rQ3R3iCaXsQYbCTNHlTZajHnlEHM3TjgTMkVKGTseNO-PY8WmeoX5Yo_NGihbPlcmc396pmTJDlvYoJ9kchTj4_NIWT946KwrCATI8x55qXHqiOoZa4mblonaaA; __cf_bm=Fq18sP8sPdixe8MbXo07QNEDAqcR5XwKFLiMgdEtUoQ-1780672644.0298758-1.0.1.1-HceHbp8cE47jNNDGfU80tDf1WPdM3CLrrufVvhvpW5bPGYc2j2383N6hqo_kgjo97e0rGqjYZTytA52irql3Vz2tAzKfDFRVhs9BgKV620EA2AcB..rD2IqQXLAAaCN1; li_mc=MTsyMTsxNzgwNjcyODAyOzI7MDIxMzpxqbIf8fbMYTfPIiIa2orjjOQEv2PKKrVGZBFIaZY=',
    vanityName: 'sergey-botalov-5aba1377',
    vieweeProfileId: 'ACoAABBYkJMBLkUd3FoURt9tjseu_sisM1vYTVU',
  })
  .then((data) => {
    const parsed = parseLinkedInAbout(data.raw);
    console.log(parsed);
  })
  .catch((err) => console.error(err));
