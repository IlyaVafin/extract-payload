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

export interface Experience {
  company: string;
  role: string;
  period: string;
  location: string;
  workType: string;
}

export function extractExperience(sduiJson: any): Experience[] {
  const experienceSection = findDeep(
    sduiJson,
    (node) =>
      node?.observabilityIdentifier ===
      'com.linkedin.sdui.impl.profile.components.experienceTopLevelSection',
  );

  if (!experienceSection) return [];

  const results: Experience[] = [];
  const items = collectDeep(
    experienceSection,
    (node) =>
      typeof node?.componentKey === 'string' &&
      node.componentKey.startsWith('entity-collection-item'),
  );

  items.forEach((item) => {
    const subPositions = collectDeep(
      item,
      (node) => Array.isArray(node) && node[1] === 'li',
    );

    if (subPositions.length > 0) {
      // КЕЙС 1: Группа (Компания -> Роли)
      const headerTexts = getVisibleTexts(item, true);
      const companyName = headerTexts[0] || 'Unknown Company';

      // Ищем общую локацию компании.
      // Пропускаем период, длительность (например "3 г. 6 мес."), тип и формат работы
      let companyLocation = '';
      for (let i = 1; i < headerTexts.length; i++) {
        const t = headerTexts[i];
        if (
          !isPeriod(t) &&
          !isDuration(t) &&
          !isWorkFormat(t) &&
          !isEmploymentType(t) &&
          isLikelyLocation(t)
        ) {
          companyLocation = t;
          break; // Нашли первую подходящую под локацию строку
        }
      }

      subPositions.forEach((pos) => {
        const posTexts = getVisibleTexts(pos);
        const mapped = mapFields(posTexts, false, companyLocation);
        results.push({
          company: companyName,
          role: mapped.role,
          period: mapped.period,
          location: mapped.location || companyLocation || '',
          workType: mapped.workType,
        });
      });
    } else {
      // КЕЙС 2: Одиночная запись
      const texts = getVisibleTexts(item);
      const mapped = mapFields(texts, true, '');
      results.push(mapped);
    }
  });

  return results;
}

/**
 * Распределяет строки по полям: Роль, Компания, Период, Локация, Формат работы
 */
function mapFields(
  texts: string[],
  isSingle: boolean,
  groupLocation: string,
): Experience {
  const res: Experience = {
    role: '',
    company: '',
    period: '',
    location: groupLocation,
    workType: '',
  };

  if (texts.length === 0) return res;

  res.role = texts[0];
  let startIndex = 1;

  if (isSingle && texts.length > 1) {
    res.company = texts[1];
    startIndex = 2;
  }

  let employmentType = '';

  // Проходим по оставшимся строкам и классифицируем их
  for (let i = startIndex; i < texts.length; i++) {
    const t = texts[i];

    if (isPeriod(t)) {
      res.period = t;
    } else if (isWorkFormat(t)) {
      res.workType = t;
    } else if (isEmploymentType(t)) {
      employmentType = t;
    } else if (isDuration(t)) {
      // Это просто строка стажа (например "3 г. 6 мес.") - игнорируем, она уже есть внутри period
    } else if (isLikelyLocation(t)) {
      // Если для роли явно указана своя локация, перезаписываем групповую
      res.location = t;
    }
  }

  // Прикрепляем тип занятости ("Полный рабочий день" и т.п.) к периоду, если он был найден отдельно
  if (
    employmentType &&
    res.period &&
    !res.period.toLowerCase().includes(employmentType.toLowerCase())
  ) {
    res.period = `${employmentType} · ${res.period}`;
  }

  return res;
}

// ==========================================
// Строгие классификаторы строк
// ==========================================

// function isPeriod(text: string): boolean {
//   const lower = text.toLowerCase();
//   const hasYearOrPresent =
//     /(20\d{2}|19\d{2})/.test(text) || lower.includes('настоящее время');
//   const hasDash =
//     text.includes('–') || text.includes('-') || text.includes('—');
//   return hasYearOrPresent && hasDash;
// }

function isDuration(text: string): boolean {
  // Исключаем периоды, чтобы не сломать даты
  if (isPeriod(text)) return false;
  // Ловит "3 г. 6 мес.", "1 год", "5 лет"
  return /\d+\s*(г\.|мес|год|лет|года)/i.test(text);
}

function isEmploymentType(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes('полный рабочий день') ||
    lower.includes('контракт') ||
    lower.includes('частичная занятость') ||
    lower.includes('фриланс') ||
    lower.includes('стажировка') ||
    lower.includes('сезонная') ||
    lower.includes('full-time') ||
    lower.includes('part-time') ||
    lower.includes('contract')
  );
}

function isWorkFormat(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes('гибрид') ||
    lower.includes('удален') ||
    lower.includes('в офисе') ||
    lower.includes('remote') ||
    lower.includes('hybrid') ||
    lower.includes('on-site')
  );
}

function isLikelyLocation(text: string): boolean {
  if (text.length > 60 || text.length < 3) return false;
  if (text.includes('\n') || text.includes('•')) return false;

  const lower = text.toLowerCase();
  if (
    lower.includes('responsible') ||
    lower.includes('managed') ||
    lower.includes('опыт')
  )
    return false;

  return true;
}

// ==========================================
// Утилиты поиска и обработки текста
// ==========================================

function getVisibleTexts(node: any, skipList: boolean = false): string[] {
  const acc: string[] = [];
  const blacklist = new Set([
    'div',
    'hr',
    'li',
    'ul',
    'p',
    'span',
    'br',
    'section',
    'button',
    'a',
    'svg',
    'path',
    'figure',
    'canvas',
  ]);

  const walk = (n: any) => {
    if (!n) return;
    if (typeof n === 'string') {
      // ВАЖНО: Заменяем неразрывные пробелы (\u00A0) на обычные. Иначе ломаются RegExp.
      const s = n.replace(/\u00A0/g, ' ').trim();
      const isTechnical =
        s.includes('$') ||
        s.includes('attr-') ||
        s.startsWith('_') ||
        s.includes('«');
      const isDescription =
        s.length > 100 || s.includes('\n') || s.includes('•');

      if (
        s.length > 1 &&
        !isTechnical &&
        !isDescription &&
        !blacklist.has(s.toLowerCase()) &&
        s !== 'развернуть'
      ) {
        acc.push(s);
      }
      return;
    }
    if (Array.isArray(n)) {
      if (skipList && (n[1] === 'li' || n[1] === 'ul')) return;
      n.forEach((i) => walk(i));
    } else if (typeof n === 'object') {
      if (n.expansionKey) return;
      if (n.children) walk(n.children);
      if (n.textProps) walk(n.textProps);
      if (n.text) walk(n.text);
    }
  };

  walk(node);
  return Array.from(new Set(acc));
}

function findDeep(node: any, predicate: (n: any) => boolean): any {
  if (predicate(node)) return node;
  if (!node || typeof node !== 'object') return null;
  for (const key in node) {
    if (Object.prototype.hasOwnProperty.call(node, key)) {
      const res = findDeep(node[key], predicate);
      if (res) return res;
    }
  }
  return null;
}

function collectDeep(
  node: any,
  predicate: (n: any) => boolean,
  acc: any[] = [],
): any[] {
  if (predicate(node)) acc.push(node);
  if (!node || typeof node !== 'object') return acc;
  if (Array.isArray(node)) {
    node.forEach((el) => collectDeep(el, predicate, acc));
  } else {
    for (const key in node) {
      if (Object.prototype.hasOwnProperty.call(node, key)) {
        collectDeep(node[key], predicate, acc);
      }
    }
  }
  return acc;
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

    vanityName: 'sergey-botalov-5aba1377',
    vieweeProfileId: 'ACoAABBYkJMBLkUd3FoURt9tjseu_sisM1vYTVU',
  })
  .then((res) => {
    const obj = parseSDUI(res.raw);
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
  workType: string;
}

type AnyNode = any;

const TEXT_LINE_MODULE_ID = '85b20fca39223dffe536dd03122e5f56';
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

const WORK_TYPE_TOKENS = [
  'удаленная работа',
  'удалённая работа',
  'remote',
  'гибридный формат работы',
  'гибридный',
  'hybrid',
  'полный рабочий день',
  'full-time',
  'частичная занятость',
  'part-time',
  'фриланс',
  'freelance',
  'контракт',
  'contract',
];

function isPeriod(text: string): boolean {
  return PERIOD_RE.test(text);
}

function isWorkType(text: string): boolean {
  const low = text.toLowerCase().trim();
  return WORK_TYPE_TOKENS.some((t) => low.includes(t));
}

function parseCompanyLine(text: string): { company: string; workType: string } {
  const parts = text.split(/\s*·\s*/);
  if (parts.length >= 2 && isWorkType(parts[parts.length - 1])) {
    return {
      company: parts.slice(0, -1).join(' · ').trim(),
      workType: parts[parts.length - 1].trim(),
    };
  }
  return { company: text.trim(), workType: '' };
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
  workType: string;
  location: string;
}

function classifySecondaryTextLine(text: string): {
  period?: string;
  location?: string;
  workType?: string;
} {
  // Сначала проверяем — это период?
  if (isPeriod(text)) return { period: text };

  // Иначе пробуем разбить по · и проверить последний фрагмент на workType
  const parts = text.split(/\s*·\s*/);
  const last = parts[parts.length - 1];

  if (parts.length >= 2 && isWorkType(last)) {
    return {
      location: parts.slice(0, -1).join(' · ').trim(),
      workType: last.trim(),
    };
  }

  // Весь текст — либо workType, либо location
  if (isWorkType(text)) return { workType: text };
  return { location: text };
}

function parseLi(li: AnyNode): PositionData {
  const { paragraphs, textLines } = collectFields(li);
  const role = paragraphs[0] ?? '';
  let period = '',
    workType = '';
  const locationParts: string[] = [];

  for (const tl of textLines) {
    if (tl.colorExpression === 176) {
      workType = tl.text;
      continue;
    }

    const classified = classifySecondaryTextLine(tl.text);

    if (classified.period && !period) period = classified.period;
    if (classified.workType && !workType) workType = classified.workType;
    if (classified.location) locationParts.push(classified.location);
  }
  return { role, period, workType, location: locationParts.join(', ') };
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
      workType: pos.workType,
      location: pos.location || parentLocation,
    };
  });
}

function parseFlat(entryNode: AnyNode): Experience {
  const { paragraphs, textLines } = collectFields(entryNode);
  const role = paragraphs[0] ?? '';
  const { company, workType: workTypeFromP } = parseCompanyLine(
    paragraphs[1] ?? '',
  );
  let period = '',
    workType = workTypeFromP;
  const locationParts: string[] = [];

  for (const tl of textLines) {
    if (tl.colorExpression === 176) {
      workType = tl.text;
      continue;
    }

    const classified = classifySecondaryTextLine(tl.text);

    if (classified.period && !period) period = classified.period;
    if (classified.workType && !workType) workType = classified.workType;
    if (classified.location) locationParts.push(classified.location);
  }
  return {
    company,
    role,
    period,
    workType,
    location: locationParts.join(', '),
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
