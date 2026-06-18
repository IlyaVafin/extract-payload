/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import fetchCookie from 'fetch-cookie';
import fs from 'fs';
import fetchBase, { RequestInit, Response } from 'node-fetch';
import { CookieJar } from 'tough-cookie';
import { parseSDUI } from './parseSDUI';
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

const linkedIn = new LinkedInProfileCardsBelowActivityClient();
linkedIn
  .postProfileCardsBelowActivity({
    cookie:
      'bcookie="v=2&0bff0c56-5f68-44ef-8530-9b087162b5cd"; bscookie="v=1&2025121307340691143906-79e0-47d2-8ec9-da7ef5f039b6AQGUdUbRCwoxZNQ0om8uuaDZ9rjNI7dV"; li_alerts=e30=; li_gc=MTsyMTsxNzY2ODQzMzk4OzI7MDIxvo25DqkPC857BEio9Bt1+63x5PRJqy/hKEt02UTQl40=; li_theme=light; li_theme_set=app; dfpfpt=d0b881af6df348b0b74f9b71879abbd5; _pxvid=d7dee901-e32a-11f0-967d-bc8e2be6d821; aam_uuid=05823511190603889814147778553090456797; timezone=Europe/Moscow; gpv_pn=developer.linkedin.com%2Fproduct-catalog; s_tp=5751; mbox=PC#77e9a1d9ae4c4141aa9e4aa4b3f4f836.37_0#1794666480|session#8a8d2e3177234eb99e4c3447b1923772#1779116340; s_ips=911; s_tslv=1779114481584; visit=v=1&M; _gcl_au=1.1.961100378.1774812283.308313686.1779809921.1779809946; g_state={"i_l":0}; li_rm=AQF2-NcUBiGsbAAAAZ6MiSHsXpak3bMoJ61Hj0TadOIPAURXkhKM9ntBmWgFWjcNo0nDyZBaVNcijPU5HBo2NSsWx-Y5ljx8Y0Xg0NCGh8LHnVddGqNaEau-lISIfy9-QFv0_Rr4qTRG3DwOLhZDGmUq7cJMLRWBj7eI35N5nAQIRVzTjpfZtt1Qfs1ZZxsvlOdesY5FaMqDLeSkrZ6KM2FumW8UqPn5DgrAUFb_1yTEU6IZbVUogph9E6OfdZ-b6I2JtGRXlHpIkJPW8p4ltbNP2XVgFfxh9KKQ1ALrOVC7XKLME_yqH7YCxKRoApUxPWrQ3PPCt_MaDhhkR3rgBw; liap=true; JSESSIONID="ajax:3380652305041475523"; AMCV_14215E3D5995C57C0A495C55%40AdobeOrg=-637568504%7CMCIDTS%7C20614%7CMCMID%7C06383176159209553264125562938956336918%7CMCAAMLH-1781616203%7C6%7CMCAAMB-1781616203%7CRKhpRz8krg2tLO6pguXWp5olkAcUniQYPHaMWWgdJ3xzPWQmdj0y%7CMCOPTOUT-1781018603s%7CNONE%7CvVersion%7C5.1.1%7CMCCIDH%7C1117101140; _uetvid=d1d0866001ad11f1944a97ff33bbda45; sdui_ver=sdui-flagship:0.1.42733+SduiFlagship0; li_at=AQEDAWQo7A0EMEjUAAABnoyJIcgAAAGe2Wwf5FYAjt63Vx-xcYynqjlyjZ9dq-BPb0jAXjciOIKisFp2GQi2HvAWV1vs0uxIOxZvYkNKw6J7RrQACVaIhKu4OwnU5VV0NYVg65DpAzVvVs-ZGr8wQokg; lidc="b=VB69:s=V:r=V:a=V:p=V:g=5252:u=12:x=1:i=1781159402:t=1781245802:v=2:sig=AQESd6u2zRg860QjcRYW5MUIBeHxI5eC"; li_mc=MTsyMTsxNzgxMTg3NTM2OzE7MDIxIRgPlLzWd4o1kvtl7umSKHQIay6zKkqJYCbBDkg8Nbw=; lang=v=2&lang=ru-ru; fptctx2=AQG1l6gd3rnSvRSB%252fLdVuWB3aNKh8qlcnSdx%252bl54VlA8zoSxgi6QxtPHtNP8FRNy%252b3NxSMh6XLoiiB6B6zSJAadT7bcIVyLMaZDSC1oDDS%252foxpVDF3xi9F2PnlCS7Kjwk%252bDU%252fpyLhRrsTz%252faF2YSaiM2%252bctOG4GRb1lIT35HKFAf17SLQuIh1OqjkB3kg7cGZnj23Fu0G9N7azVzjPCpcIIdjN1%252fXvMmssahLquKKhag1MKAd0cdV6wkxqaOLTEQTzt6s0AIt%252bMFYSkZIU0QdiPcHZAzIUgxBX0xcoEx0Msf1NKh5iHM%252flFqWjbWsQAR%252fVFuR9NFn0oEpH8HQUmKm%252bzN; __cf_bm=BWzRitsWl1.f3D.N0CSFwwz5viDdSHEHmNoTDmUJ2v4-1781187581.8242874-1.0.1.1-vIyFBUv2oyldXBoOoJLWlLRQ4ViiX9uNSD9z_EI9H4kr8TyeLYYlEyDxhpG89lMIS09VqM1RKpL98pqHIn1CNjRKgRC4wAFg6VfJ8EuFIrMGiJzD0CSBBIy0Zlu0sUy.; UserMatchHistory=AQI6zi8VpC_pBQAAAZ63EJ5M6nSWDsH2sOASOfYEQYVmK7u8B0rEMfYAV7gSeIKnf17HfQMEhMdi3n2H_mBmNluCP-9lCKSbAPArGBqM7jkIIGRgk3hV7JKGGhkeyN1A-WevOlX3Ooo1D-PYTF9keFz06nTM7ns0sgYBbUTiie5WpkV7X7SfFyVrydZR1DEK4o4QDxO2WsUPLQ9LY1nqIB7wdRDirugwVgyquFr2XUyPTb0dr5uyonwUFOSBPJJkhwZtxWWuPDPLzCBwMkxlK23wRHLpHnI92lsIWIja6PloxwZcd3dmPLV-F5JDLnvfgpGwKBhGAQ6U8V00rwgodwF9nvOnRLcAG23lwj8V1WgxGZKaqw',
    // vanityName: 'ben-barr-7356a9bb',
    // vieweeProfileId: 'ACoAABmNotkBK1YD87eASNSoNQNmpMSEqP8KO8w',

    // vanityName: 'mdemenshina',
    // vieweeProfileId: 'ACoAAFtVCs8BimDBo_Ysv6EuvhGytHlm6w1opV0',

    // vanityName: 'sergey-botalov-5aba1377',
    // vieweeProfileId: 'ACoAABBYkJMBLkUd3FoURt9tjseu_sisM1vYTVU',

    // vanityName: 'liliya-gabdrakhmanova-4b095882',
    // vieweeProfileId: 'ACoAABGVGcQBLpNo7VqziJss5mRAMVq44toFEso',

    // vanityName: 'svetlana-lavrukhina-278b4458',
    // vieweeProfileId: 'ACoAAAxFZHwB_14HxOZLQ7GEQbDuX1DEeuAPOHM',

    // vanityName: 'denis-titkov',
    // vieweeProfileId: 'ACoAABN7m6QBp_ZzkckcJZNiROCpICy20ubulA0',

    vanityName: 'dmitry-kvitkovsky-aa0b19267',
    vieweeProfileId: 'ACoAAEF7x9gBEAcGKU6tz5q9jNFeG3y20vxajN8',
  })
  .then((res) => {
    const obj: unknown = parseSDUI(res.raw);
    fs.writeFileSync('./res.json', JSON.stringify(obj, null, 2), {
      encoding: 'utf-8',
    });
    const experience = extractExperiences(obj);
    console.log(experience);
  })
  .catch((err) => {
    console.error(err);
  });

export interface Experience {
  company: string;
  role: string;
  period: string;
  location: string;
  employmentType: string;
  workplaceType: string;
  description: string;
}

type AnyNode = any;

const EMPLOYMENT_TYPE_TOKENS = [
  'полный рабочий день',
  'full-time',
  'частичная занятость',
  'part-time',
  'фриланс',
  'freelance',
  'контракт',
  'contract',
  'internship',
  'стажировка',
];

const WORKPLACE_TYPE_TOKENS = [
  'удаленная работа',
  'удалённая работа',
  'remote',
  'гибридный формат работы',
  'гибридный',
  'hybrid',
  'работа в офисе',
  'on-site',
  'onsite',
];
// ЖЕЛАТЕЛЬНО СЛЕДИТЬ ЗА ЭТИМИ ID ДОБАВИТЬ КАКОЙ НИБУДЬ ЛОГ ЧТОБЫ ПОНИМАТЬ ИЗМЕНИЛИСЬ ОНИ ИЛИ НЕТ
const TEXT_LINE_MODULE_ID = '85b20fca39223dffe536dd03122e5f56';
const DESCRIPTION_MODULE_ID = '1e9b95c01e7f142c1ba9a289f4714a9c';
const EXPERIENCE_SECTION_ID =
  'com.linkedin.sdui.impl.profile.components.experienceTopLevelSection';

function walk(node: AnyNode, visit: (n: AnyNode) => void): void {
  if (node === null || node === undefined || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((c) => walk(c, visit));
    return;
  }
  if (node.$$typeof === 'react.element') visit(node);
  for (const k of Object.keys(node)) walk(node[k], visit);
}

function extractDescription(node: AnyNode): string {
  let description = '';
  walk(node, (n) => {
    if (n?.type?.moduleId !== DESCRIPTION_MODULE_ID) return;
    const children = n?.props?.textProps?.children;
    if (!Array.isArray(children)) return;

    const lines: string[] = [];
    for (const item of children) {
      // children — массив массивов React.Fragment
      const arr = Array.isArray(item) ? item : [item];
      for (const fragment of arr) {
        const fragmentChildren = fragment?.props?.children;
        if (!Array.isArray(fragmentChildren)) continue;
        for (const child of fragmentChildren) {
          if (typeof child === 'string' && child.trim()) {
            lines.push(child.trim());
          }
        }
      }
    }
    description = lines.join('\n');
  });
  return description;
}

function classifyWorkString(text: string): 'employment' | 'workplace' | null {
  const low = text.toLowerCase().trim();
  if (EMPLOYMENT_TYPE_TOKENS.some((t) => low.includes(t))) return 'employment';
  if (WORKPLACE_TYPE_TOKENS.some((t) => low.includes(t))) return 'workplace';
  return null;
}

function walkSkip(
  node: AnyNode,
  skipType: string,
  visit: (n: AnyNode) => void,
): void {
  if (node === null || node === undefined || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((c) => walkSkip(c, skipType, visit));
    return;
  }
  if (node.$$typeof === 'react.element') {
    if (node.type === skipType) return;
    visit(node);
  }
  for (const k of Object.keys(node)) walkSkip(node[k], skipType, visit);
}

function findFirst<T>(node: AnyNode, pred: (n: AnyNode) => T | null): T | null {
  let result: T | null = null;
  walk(node, (n) => {
    if (result === null) {
      const v = pred(n);
      if (v !== null) result = v;
    }
  });
  return result;
}

function pText(node: AnyNode): string | null {
  if (node?.type !== 'p') return null;
  const c = node?.props?.children;
  if (typeof c === 'string' && c.trim()) return c.trim();
  if (Array.isArray(c)) {
    const strs = c.filter((x: any) => typeof x === 'string' && x.trim());
    if (strs.length === 1) return strs[0].trim();
  }
  return null;
}

interface TextLine {
  text: string;
  colorExpression: number;
}

function textLine(node: AnyNode): TextLine | null {
  if (node?.type?.moduleId !== TEXT_LINE_MODULE_ID) return null;
  const children = node?.props?.textProps?.children;
  const colorExpression = node?.props?.textColorExpression ?? 179;
  let text: string | null = null;
  if (typeof children === 'string' && children.trim()) text = children.trim();
  else if (Array.isArray(children)) {
    const strs = children.filter((x: any) => typeof x === 'string' && x.trim());
    if (strs.length >= 1) text = strs.join('').trim();
  }
  return text ? { text, colorExpression } : null;
}

const PERIOD_RE = /\d{4}|настоящее\s+время|present/i;

function isPeriod(text: string): boolean {
  return PERIOD_RE.test(text);
}

function isWorkType(text: string): boolean {
  return classifyWorkString(text) !== null;
}

function parseCompanyLine(text: string): {
  company: string;
  employmentType: string;
} {
  const parts = text.split(/\s*·\s*/);
  const last = parts[parts.length - 1];
  if (parts.length >= 2 && classifyWorkString(last) === 'employment') {
    return {
      company: parts.slice(0, -1).join(' · ').trim(),
      employmentType: last.trim(),
    };
  }
  return { company: text.trim(), employmentType: '' };
}

interface RawFields {
  paragraphs: string[];
  textLines: TextLine[];
}

function collectFields(node: AnyNode, skipType?: string): RawFields {
  const paragraphs: string[] = [];
  const textLines_: TextLine[] = [];
  const visitor = (n: AnyNode) => {
    const p = pText(n);
    if (p) {
      paragraphs.push(p);
      return;
    }
    const tl = textLine(n);
    if (tl) textLines_.push(tl);
  };
  if (skipType) walkSkip(node, skipType, visitor);
  else walk(node, visitor);
  return { paragraphs, textLines: textLines_ };
}

interface PositionData {
  role: string;
  period: string;
  employmentType: string;
  workplaceType: string;
  location: string;
  description: string;
}

function classifySecondaryTextLine(text: string): {
  period?: string;
  location?: string;
  employmentType?: string;
  workplaceType?: string;
} {
  if (isPeriod(text)) return { period: text };

  const parts = text.split(/\s*·\s*/);
  const result: ReturnType<typeof classifySecondaryTextLine> = {};

  for (const part of parts) {
    const kind = classifyWorkString(part.trim());
    if (kind === 'employment') result.employmentType = part.trim();
    else if (kind === 'workplace') result.workplaceType = part.trim();
    else result.location = part.trim();
  }

  return result;
}

function parseLi(li: AnyNode): PositionData {
  const { paragraphs, textLines } = collectFields(li);
  const role = paragraphs[0] ?? '';
  let period = '',
    employmentType = '',
    workplaceType = '';
  const locationParts: string[] = [];

  for (const tl of textLines) {
    if (tl.colorExpression === 176) {
      employmentType = tl.text;
      continue;
    }
    const classified = classifySecondaryTextLine(tl.text);
    if (classified.period && !period) period = classified.period;
    if (classified.employmentType && !employmentType)
      employmentType = classified.employmentType;
    if (classified.workplaceType && !workplaceType)
      workplaceType = classified.workplaceType;
    if (classified.location) locationParts.push(classified.location);
  }
  return {
    role,
    period,
    employmentType,
    workplaceType,
    description: extractDescription(li),
    location: locationParts.join(', '),
  };
}

function parseGrouped(entryNode: AnyNode): Experience[] {
  const { paragraphs, textLines } = collectFields(entryNode, 'ul'); // не заходим в <ul>
  const rawCompany = paragraphs[0] ?? '';
  const parentLocation =
    textLines.find((tl) => !isPeriod(tl.text) && !isWorkType(tl.text))?.text ??
    '';
  const { company } = parseCompanyLine(rawCompany);

  const liNodes: AnyNode[] = [];
  findFirst(entryNode, (n: AnyNode) => {
    if (n?.type === 'ul') {
      const children = n?.props?.children;
      const arr = Array.isArray(children) ? children : [children];
      arr.forEach((c: AnyNode) => {
        if (c?.type === 'li') liNodes.push(c);
      });
      return true;
    }
    return null;
  });

  return liNodes.map((li) => {
    const pos = parseLi(li);
    return {
      company,
      role: pos.role,
      period: pos.period,
      employmentType: pos.employmentType,
      workplaceType: pos.workplaceType,
      location: pos.location || parentLocation,
      description: pos.description,
    };
  });
}

function parseFlat(entryNode: AnyNode): Experience {
  const { paragraphs, textLines } = collectFields(entryNode);
  const role = paragraphs[0] ?? '';
  // parseCompanyLine тоже нужно обновить чтобы возвращал employmentType
  const { company, employmentType: etFromP } = parseCompanyLine(
    paragraphs[1] ?? '',
  );
  let period = '',
    employmentType = etFromP,
    workplaceType = '';
  const locationParts: string[] = [];

  for (const tl of textLines) {
    if (tl.colorExpression === 176 && !employmentType) {
      employmentType = tl.text;
      continue;
    }
    const classified = classifySecondaryTextLine(tl.text);
    if (classified.period && !period) period = classified.period;
    if (classified.employmentType && !employmentType)
      employmentType = classified.employmentType;
    if (classified.workplaceType && !workplaceType)
      workplaceType = classified.workplaceType;
    if (classified.location) locationParts.push(classified.location);
  }

  return {
    company,
    role,
    period,
    employmentType,
    workplaceType,
    location: locationParts.join(', '),
    description: extractDescription(entryNode),
  };
}

export function extractExperiences(sduiTree: unknown): Experience[] {
  const experiences: Experience[] = [];

  walk(sduiTree, (sectionCandidate) => {
    if (
      sectionCandidate?.props?.observabilityIdentifier !== EXPERIENCE_SECTION_ID
    )
      return;

    walk(sectionCandidate, (entryNode) => {
      const componentKey = entryNode?.props?.componentKey;
      if (
        typeof componentKey !== 'string' ||
        !componentKey.startsWith('entity-collection-item-')
      )
        return;

      const hasUl =
        findFirst(entryNode, (n) => (n?.type === 'ul' ? true : null)) !== null;
      if (hasUl) experiences.push(...parseGrouped(entryNode));
      else experiences.push(parseFlat(entryNode));
    });
  });

  return experiences;
}
