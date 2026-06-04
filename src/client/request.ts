import fetchCookie from 'fetch-cookie';
import fetchBase, { RequestInit, Response } from 'node-fetch';
import { CookieJar } from 'tough-cookie';
import { extractPayload } from './extract-payload';

type FetchFunction = (url: string, init?: RequestInit) => Promise<Response>;
const nodeFetch: FetchFunction = (url, init) => fetchBase(url, init);
const fetch = fetchCookie<string, RequestInit, Response>(
  nodeFetch,
  new CookieJar(),
) as FetchFunction;

const BROWSEMAP_NAVIGATION_PATH = '/flagship-web/rsc-action/actions/navigation';

const BROWSEMAP_SCREEN_ID =
  'com.linkedin.sdui.flagshipnav.profile.ProfileOverlayBrowsemap';

const PROFILE_OVERLAY_PYMK_LIST_SCREEN_ID =
  'com.linkedin.sdui.flagshipnav.profile.ProfileOverlayPymkList';

const DEFAULT_BASE_URL = 'https://www.linkedin.com';

export interface Profile {
  fullName?: string;
  headline?: string;
  publicIdentifier?: string;
  profileUrl?: string;
  [key: string]: any;
}

export class LinkedInAccountBannedError extends Error {
  constructor(message = 'LinkedIn account banned') {
    super(message);
    this.name = 'LinkedInAccountBannedError';
  }
}

export class LinkedInProfilesYouMayKnowClient {
  private baseURL = DEFAULT_BASE_URL.replace(/\/+$/, '');

  private navigationRequestURL(screenId: string): string {
    const url = new URL(`${this.baseURL}${BROWSEMAP_NAVIGATION_PATH}`);

    url.searchParams.set('screenId', screenId);
    url.searchParams.set('sduiid', screenId);

    return url.toString();
  }

  private normalizeVanity(anchorVanity: string): string {
    const value = anchorVanity.trim();
    if (!value) throw new Error('anchorVanity is empty');

    const match = value.match(/linkedin\.com\/in\/([^/?]+)/i);
    if (match?.[1]) return decodeURIComponent(match[1]);

    return value.replace(/^\/+|\/+$/g, '');
  }

  private extractCsrfFromCookie(cookie: string) {
    const match = cookie.match(/JSESSIONID="([^"]+)"/);
    if (!match) throw new Error('No JSESSIONID in cookie');
    return match[1];
  }

  private async warmSession(cookie: string) {
    await fetch(`${this.baseURL}/feed`, {
      headers: { Cookie: cookie },
    });
  }

  async getProfilesYouMayKnow(params: {
    cookie: string;
    anchorVanity: string;
    signal?: AbortSignal;
  }) {
    const { cookie, anchorVanity, signal } = params;

    const vanity = this.normalizeVanity(anchorVanity);

    // 🔥 IMPORTANT: прогрев сессии
    await this.warmSession(cookie);

    // 🔥 CSRF НЕ доверяем ручному — пересчитываем
    const csrf = this.extractCsrfFromCookie(cookie);

    const body = {
      isModal: true,
      clientArguments: {
        $type: 'proto.sdui.actions.requests.RequestedArguments',
        requestedStateKeys: [],
        requestMetadata: {
          $type: 'proto.sdui.common.RequestMetadata',
        },
        states: [],
        screenId: BROWSEMAP_SCREEN_ID,
        payload: {
          vanityName: vanity,
          isVanityNameResolved: true,
        },
      },
    };

    const response = await fetch(
      this.navigationRequestURL(BROWSEMAP_SCREEN_ID),
      {
        method: 'POST',
        signal,
        headers: {
          'csrf-token': csrf,
          Cookie: cookie,
          'content-type': 'application/json',
          accept: '*/*',
          origin: this.baseURL,
          referer: `${this.baseURL}/in/${vanity}/`,
        },
        body: JSON.stringify(body),
      },
    );

    const raw = await response.text();

    if (!response.ok) {
      const snippet = raw.length > 512 ? raw.slice(0, 512) + '…' : raw;

      if (response.status === 999) {
        throw new LinkedInAccountBannedError();
      }

      throw new Error(`linkedin: status ${response.status}: ${snippet}`);
    }

    return {
      raw,
    };
  }

  async getProfileOverlayPymkList(params: {
    cookie: string;
    anchorVanity: string;
    firstName: string;
    sectionType: string;
    isSelfProfile: boolean;
    signal?: AbortSignal;
  }) {
    const {
      cookie,
      anchorVanity,
      firstName,
      sectionType,
      isSelfProfile,
      signal,
    } = params;

    const vanity = this.normalizeVanity(anchorVanity);

    await this.warmSession(cookie);
    const csrf = this.extractCsrfFromCookie(cookie);

    const body = {
      isModal: true,
      clientArguments: {
        $type: 'proto.sdui.actions.requests.RequestedArguments',
        payload: {
          vanityName: vanity,
          sectionType,
          isSelfProfile,
          firstName,
          isVanityNameResolved: true,
        },
        requestedStateKeys: [],
        requestMetadata: {
          $type: 'proto.sdui.common.RequestMetadata',
        },
        states: [],
        screenId: PROFILE_OVERLAY_PYMK_LIST_SCREEN_ID,
      },
    };

    const response = await fetch(
      this.navigationRequestURL(PROFILE_OVERLAY_PYMK_LIST_SCREEN_ID),
      {
        method: 'POST',
        signal,
        headers: {
          'csrf-token': csrf,
          Cookie: cookie,
          'content-type': 'application/json',
          accept: '*/*',
          origin: this.baseURL,
          referer: `${this.baseURL}/in/${vanity}/`,
        },
        body: JSON.stringify(body),
      },
    );

    const raw = await response.text();

    if (!response.ok) {
      const snippet = raw.length > 512 ? raw.slice(0, 512) + '…' : raw;

      if (response.status === 999) {
        throw new LinkedInAccountBannedError();
      }

      throw new Error(`linkedin: status ${response.status}: ${snippet}`);
    }

    return {
      raw,
    };
  }
}

const linkedin = new LinkedInProfilesYouMayKnowClient();

async function main() {
  try {
    const { raw } = await linkedin.getProfileOverlayPymkList({
      cookie:
        'bcookie="v=2&0bff0c56-5f68-44ef-8530-9b087162b5cd"; bscookie="v=1&2025121307340691143906-79e0-47d2-8ec9-da7ef5f039b6AQGUdUbRCwoxZNQ0om8uuaDZ9rjNI7dV"; li_alerts=e30=; li_gc=MTsyMTsxNzY2ODQzMzk4OzI7MDIxvo25DqkPC857BEio9Bt1+63x5PRJqy/hKEt02UTQl40=; li_theme=light; li_theme_set=app; dfpfpt=d0b881af6df348b0b74f9b71879abbd5; _pxvid=d7dee901-e32a-11f0-967d-bc8e2be6d821; aam_uuid=05823511190603889814147778553090456797; timezone=Europe/Moscow; gpv_pn=developer.linkedin.com%2Fproduct-catalog; s_tp=5751; _uetvid=d1d0866001ad11f1944a97ff33bbda45; mbox=PC#77e9a1d9ae4c4141aa9e4aa4b3f4f836.37_0#1794666480|session#8a8d2e3177234eb99e4c3447b1923772#1779116340; s_ips=911; s_tslv=1779114481584; visit=v=1&M; _gcl_au=1.1.961100378.1774812283.308313686.1779809921.1779809946; fid=AQFjfo6GH5VaeAAAAZ6JGZGvuqSCJN2rObpI_3VTl_-CXlbZACqGsUhajT5gvqkRqrl-II0JKZbIyg; g_state={"i_l":0}; li_rm=AQF2-NcUBiGsbAAAAZ6MiSHsXpak3bMoJ61Hj0TadOIPAURXkhKM9ntBmWgFWjcNo0nDyZBaVNcijPU5HBo2NSsWx-Y5ljx8Y0Xg0NCGh8LHnVddGqNaEau-lISIfy9-QFv0_Rr4qTRG3DwOLhZDGmUq7cJMLRWBj7eI35N5nAQIRVzTjpfZtt1Qfs1ZZxsvlOdesY5FaMqDLeSkrZ6KM2FumW8UqPn5DgrAUFb_1yTEU6IZbVUogph9E6OfdZ-b6I2JtGRXlHpIkJPW8p4ltbNP2XVgFfxh9KKQ1ALrOVC7XKLME_yqH7YCxKRoApUxPWrQ3PPCt_MaDhhkR3rgBw; liap=true; li_at=AQEDAWQo7A0EMEjUAAABnoyJIcgAAAGesJWlyFYAVoTMWnqhahT_7vom9AUophehHgZnVVK6zXQSAdbDpb5ylB30XiPbng3B7Rbf6QEl6DlgXUqmc1s_LwyiMVYK3ACswSii_SNq0T25PmTZuHv7TNEr; JSESSIONID="ajax:3380652305041475523"; li_mc=MTsyMTsxNzgwNTkyMjgxOzI7MDIxBSVeB4mB0x4vTmDWMNNKwd5/PmUpUmwsqt7Zp2t9GV0=; lidc="b=VB69:s=V:r=V:a=V:p=V:g=5250:u=10:x=1:i=1780592281:t=1780678681:v=2:sig=AQGIasGZinmJwBl2AVjo5FMxwhKbKXE1"; lang=v=2&lang=ru-ru; AMCVS_14215E3D5995C57C0A495C55%40AdobeOrg=1; AMCV_14215E3D5995C57C0A495C55%40AdobeOrg=-637568504%7CMCIDTS%7C20609%7CMCMID%7C06383176159209553264125562938956336918%7CMCAAMLH-1781197078%7C6%7CMCAAMB-1781197078%7CRKhpRz8krg2tLO6pguXWp5olkAcUniQYPHaMWWgdJ3xzPWQmdj0y%7CMCOPTOUT-1780599478s%7CNONE%7CvVersion%7C5.1.1%7CMCCIDH%7C1117101140; sdui_ver=sdui-flagship:0.1.42088+SduiFlagship0; fptctx2=AQErVxVd%252fJAG5x6FdpCoDCz%252f2mblbiuq%252f98UA243ddfXVZU5V9c%252b9%252bd745OjSBE8HncXwt3O%252faFthZHdNq06%252fGWmgupxUPuvyW4%252bQssmF9gMS%252bWdaLbqiM7lSBhC%252fe%252bozD6ITb7aGmD1ZVLfbfetBxgkIeLCcH3YaemeM07ujNwYWU%252fIUsw4Wjexr8FceSueS8%252fOice7s3ylsSZ9bL9fofskqnHahoHGkMOvMkK%252f%252bDXMkX7bPuhdsFlwyWJNOI%252bvtOFB%252fJ0%252bNJRRNp7vzvN53ihU2JtoDilte0uf2LFUfkjKLyaXmiCNf45XETXrJhPpqoIdWSC%252ba0xBPC%252brEBjIDnY3fb5VeHhdnx0TqARzbjNOOG79dKREssDw67qPYVrexDE%253d; __cf_bm=.EbQIHU4KfQjCqZ7LL_xlvlmVjkNr2EWiZxBVYk1aTY-1780592742.5792751-1.0.1.1-hjzSWgCj8TdjMuvz4vU8vPF9UQnSo1_gK.Ny6f1Uz6M_TLkOUr3DRoDpl_0hSbwlHMN8RF.7nqSjIf0zeOdZZKGD6EmWFa0_FfdLUhqbfWjAWBrXTT1QEE9H8kyHIvAA; UserMatchHistory=AQKbctpaHWhAigAAAZ6TmVLUBE5_GFabJVzqTqkUFFHIU-cB5Bh4Tf_iweldbwKLWiL2B5H-aWvkZ_3bpyMAxeD-iJ3D5UYEAEQT9WmJtOJtm9PhfX-0DN5M45lFuanYM4RUXbw5hIk58yut1BoOXzxHx39GMYqVsi5nyu6U832xJZsm9dD9IpZcBFWvWk8xdrKqwGMqnlvJwckVwxADUcnpP8pgS8_vKX5muA8LCK1d-HQSnS1TTyTyS4ogWzRLNJC-HqumQX5qX8nm4FIHSsqrgGxvAJMKhJxA-CBJbNg5T1tZ3qghCN-rTLNW02thfWBlCXOMcFowQU3uYBMAxHsddG26oAIDwKxW8Lb_kVtQAl_bFQ',
      anchorVanity: 'https://www.linkedin.com/in/ilya-vafin-86591b3aa/',
      firstName: 'Ilya',
      sectionType: 'pymk-recommendations-from-initial',
      isSelfProfile: true,
    });
    if (raw) {
      const extractedProfiles = extractPayload(raw);
      console.log(extractedProfiles);
    }
  } catch (error) {
    console.error(error);
  }
}

void main();
