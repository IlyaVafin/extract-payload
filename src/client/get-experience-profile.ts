import fetchCookie from 'fetch-cookie';
import fetchBase, { RequestInit, Response } from 'node-fetch';
import { CookieJar } from 'tough-cookie';
import { parseLinkedInExperience } from './experience-parser';
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

const exp = new LinkedInProfileCardsBelowActivityClient();

exp
  .postProfileCardsBelowActivity({
    cookie:
      'bcookie="v=2&0bff0c56-5f68-44ef-8530-9b087162b5cd"; bscookie="v=1&2025121307340691143906-79e0-47d2-8ec9-da7ef5f039b6AQGUdUbRCwoxZNQ0om8uuaDZ9rjNI7dV"; li_alerts=e30=; li_gc=MTsyMTsxNzY2ODQzMzk4OzI7MDIxvo25DqkPC857BEio9Bt1+63x5PRJqy/hKEt02UTQl40=; li_theme=light; li_theme_set=app; dfpfpt=d0b881af6df348b0b74f9b71879abbd5; _pxvid=d7dee901-e32a-11f0-967d-bc8e2be6d821; aam_uuid=05823511190603889814147778553090456797; timezone=Europe/Moscow; gpv_pn=developer.linkedin.com%2Fproduct-catalog; s_tp=5751; _uetvid=d1d0866001ad11f1944a97ff33bbda45; mbox=PC#77e9a1d9ae4c4141aa9e4aa4b3f4f836.37_0#1794666480|session#8a8d2e3177234eb99e4c3447b1923772#1779116340; s_ips=911; s_tslv=1779114481584; visit=v=1&M; _gcl_au=1.1.961100378.1774812283.308313686.1779809921.1779809946; fid=AQFjfo6GH5VaeAAAAZ6JGZGvuqSCJN2rObpI_3VTl_-CXlbZACqGsUhajT5gvqkRqrl-II0JKZbIyg; g_state={"i_l":0}; li_rm=AQF2-NcUBiGsbAAAAZ6MiSHsXpak3bMoJ61Hj0TadOIPAURXkhKM9ntBmWgFWjcNo0nDyZBaVNcijPU5HBo2NSsWx-Y5ljx8Y0Xg0NCGh8LHnVddGqNaEau-lISIfy9-QFv0_Rr4qTRG3DwOLhZDGmUq7cJMLRWBj7eI35N5nAQIRVzTjpfZtt1Qfs1ZZxsvlOdesY5FaMqDLeSkrZ6KM2FumW8UqPn5DgrAUFb_1yTEU6IZbVUogph9E6OfdZ-b6I2JtGRXlHpIkJPW8p4ltbNP2XVgFfxh9KKQ1ALrOVC7XKLME_yqH7YCxKRoApUxPWrQ3PPCt_MaDhhkR3rgBw; liap=true; li_at=AQEDAWQo7A0EMEjUAAABnoyJIcgAAAGesJWlyFYAVoTMWnqhahT_7vom9AUophehHgZnVVK6zXQSAdbDpb5ylB30XiPbng3B7Rbf6QEl6DlgXUqmc1s_LwyiMVYK3ACswSii_SNq0T25PmTZuHv7TNEr; JSESSIONID="ajax:3380652305041475523"; sdui_ver=sdui-flagship:0.1.42142+SduiFlagship0; lidc="b=VB69:s=V:r=V:a=V:p=V:g=5252:u=10:x=1:i=1780667479:t=1780753879:v=2:sig=AQEcugzPRcLTpBXsMcyt4aIj7Vyaoupx"; lang=v=2&lang=ru-ru; fptctx2=AQGZKve2TPRVvxacagIO3%252bElP0I8IEivJ3ivTtY%252fS40jGhpwdj2ZsuHQMZWTZucCC%252baK0cbzlNVDHCP0hYBr1AvaNzKUfrPbQ75AGJsXKHsrV3WFe37T8NoalOqgYubqeFZ7lKvnl0sf%252bIz%252fHevYGZrpOEjmptE%252bNhODf0kDkT%252bNKhMtCw5xxXk85NvHiTUxVE9cRZKrisCYv4dVBWdIjqyigk5Ojc86MjP0Yl0JxIQsdFKsJkoZGu%252bvn2P7tTVTvEMUlz9%252fvrxWaSUMuytrohWpD8BWEphkDTMKSFTUl5jIYjETr6GZbpXQdlXrzY3tMJfAsYUMsdnYfrxaNixHX7uVBfcjSG1kjeSACdhD572LEVMge8YlommgcwitUa%252bzc3o%253d; AMCVS_14215E3D5995C57C0A495C55%40AdobeOrg=1; AMCV_14215E3D5995C57C0A495C55%40AdobeOrg=-637568504%7CMCIDTS%7C20609%7CMCMID%7C06383176159209553264125562938956336918%7CMCAAMLH-1781276442%7C6%7CMCAAMB-1781276442%7CRKhpRz8krg2tLO6pguXWp5olkAcUniQYPHaMWWgdJ3xzPWQmdj0y%7CMCOPTOUT-1780678842s%7CNONE%7CvVersion%7C5.1.1%7CMCCIDH%7C1117101140; UserMatchHistory=AQLuUmCD6BXppgAAAZ6Yg5tYFzzKByp_y4JFOtZO9u6BNJQYSg_PBQ9vDECyKYOxSTvOk_YXWujDymmivBhrNyTyED4z0NFyk87_iNrKjn05FVetVaA9b5UIa258ppGfOuKHjOJsZuqrBKWNyXDJy0ryOf2hqBTzXVCMnCl2Zcx1GWTJzyJXyWxbdhl5GeoAByDt8qXYUfLGbIU2vdp_hrUJcEmTj0sExzEfefDEpEz18gd8Er4z6iL0IEFQiL4dFqGSb8KJMkPOrwIEYujQ_kcjCv2CjhL0eYFVeZ8mffXOdbkn64eVHxGfnSQBlqtZMO6FQyR5OsX9n_AdHn9Tsty9urIrAQWFjXf_OiXiWnCqMYjmgA; li_mc=MTsyMTsxNzgwNjc1OTQ2OzI7MDIxvEcQb3iGZkR/4IDWLDRuuCw7BQuUmRUTbMSKpSCyVUI=; __cf_bm=qcvNk.jv9pJK_G3TLrD30ZQ_aXDDcSJ_NN_BZbSig6o-1780676005.9912634-1.0.1.1-dB4Bl0trCSAmlFpPbG1P6Gpe6DiVfdk3eZ.PYyKSn9it.zcrOgusUm3jPRYkLCor0cj9oQcXeIKni5Y4ZDzHxbwxNbK9rOtfvt.0NRPcjKJn9S53e5AuMONLaKoztdZH',
    vanityName: 'sergey-botalov-5aba1377',
    vieweeProfileId: 'ACoAABBYkJMBLkUd3FoURt9tjseu_sisM1vYTVU',
  })
  .then((data) => {
    const result = parseLinkedInExperience(data.raw);
    console.log(result);
  })
  .catch((err) => console.error(err));
