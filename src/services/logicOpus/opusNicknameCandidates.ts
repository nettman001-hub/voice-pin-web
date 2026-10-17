import type {
  LogicOpusNicknameCandidate,
  LogicOpusSpokenNameCandidates,
} from "../../types/logicOpus.ts";
import { transliterateEnglishToKorean } from "../nicknameMatcher.ts";

/**
 * 판매자 멘트(STT) 안의 이름처럼 보이는 구간과 최근 댓글 닉네임의 유사도 점수.
 * 이 점수는 AI에게 주는 참고자료일 뿐, 구매자 결정은 AI가 한다.
 */

export { toJamo, soundDistance } from '../hangulSound.ts';
import { toJamo, soundDistance } from '../hangulSound.ts';

/** 이모지·기호·공백 제거, 소문자화 */
export function plainForm(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}\p{Extended_Pictographic}‍️]+/gu, "");
}

const HONORIFIC_TAIL = /(언니|님|씨|학생|고객님)$/u;
const PARTICLE_TAIL = /(은|는|이|가|도|께|한테|에게|이랑|랑|까지|부터)$/u;

/** 판매 멘트에 자주 나오지만 이름일 리 없는 말 (후보 잡음 줄이기용) */
const NOT_A_NAME = new Set([
  "언니", "언니들", "고객님", "그냥", "제가", "저", "이거", "그거", "저거", "이것", "그다음", "그다음에",
  "컬러", "가격", "사이즈", "원", "만원", "번호", "필요하신", "말씀해", "드릴게요", "주세요",
]);

function speechWordVariants(word: string): string[] {
  const base = plainForm(word);
  if (!base || NOT_A_NAME.has(base)) return [];
  const noHonor = base.replace(HONORIFIC_TAIL, "");
  if (!noHonor || NOT_A_NAME.has(noHonor)) return [];
  const variants = new Set([base, noHonor]);
  const noParticle = noHonor.replace(PARTICLE_TAIL, "");
  if (noParticle.length >= 1) variants.add(noParticle);
  return [...variants];
}

export function nicknameForms(nickname: string, pronunciations: string[] = []): string[] {
  const forms = new Set<string>();
  const plain = plainForm(nickname);
  if (plain) forms.add(plain);
  const hangulOnly = plain.replace(/[^가-힣]/g, "");
  if (hangulOnly.length >= 2) forms.add(hangulOnly);
  const latin = plain.replace(/[^a-z]/g, "");
  if (latin.length >= 2) {
    forms.add(latin);
    const kor = transliterateEnglishToKorean(latin);
    if (kor && /[가-힣]/.test(kor)) forms.add(kor);
  }
  for (const p of pronunciations) {
    const f = plainForm(p);
    if (f) forms.add(f);
  }
  return [...forms];
}

function rawSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const ja = toJamo(a);
  const jb = toJamo(b);
  return Math.max(0, 1 - soundDistance(ja, jb) / Math.max(ja.length, jb.length));
}

/**
 * 멘트 쪽 이름(spoken)과 닉네임 형태(form)의 유사도 0~1.
 * 판매자는 닉네임 일부만 부르기도 하므로("호연"→"한호윤") 닉네임의 같은 길이 부분과도 비교한다.
 */
export function formSimilarity(spoken: string, form: string): number {
  if (!spoken || !form) return 0;
  let best = rawSimilarity(spoken, form);
  if (best >= 1) return 1;
  if (spoken.length >= 2 && form.includes(spoken)) best = Math.max(best, 0.85);
  const s = [...spoken];
  const f = [...form];
  if (s.length >= 2 && f.length > s.length && /[가-힣]/.test(spoken)) {
    for (let i = 0; i + s.length <= f.length; i++) {
      best = Math.max(best, rawSimilarity(spoken, f.slice(i, i + s.length).join("")) * 0.9);
    }
  }
  return Math.min(1, best);
}

export interface CandidateNickname {
  nickname: string;
  lastAt: number;
  recentIntent: boolean;
  pronunciations?: string[];
}

const MIN_SCORE = 0.65;

/**
 * 멘트 한 줄에서 1~3어절 구간을 만들어 닉네임 형태와 비교한다.
 * 같은 구간에 대해 점수 상위 5명을 돌려준다.
 */
export function findSpokenNameCandidates(
  eventId: string,
  speech: string,
  nicknames: CandidateNickname[],
  maxGroups = 4,
): LogicOpusSpokenNameCandidates[] {
  const words = speech.split(/[\s,.!?~·]+/u).filter(Boolean);
  const windows: Array<{ spoken: string; forms: string[]; start: number; len: number }> = [];
  for (let i = 0; i < words.length; i++) {
    for (let len = 1; len <= 3 && i + len <= words.length; len++) {
      const raw = words.slice(i, i + len).join(" ");
      const joined = words.slice(i, i + len).join("");
      const forms = speechWordVariants(joined);
      if (forms.length) windows.push({ spoken: raw, forms, start: i, len });
    }
  }
  const prepared = nicknames.map((n) => ({ ...n, forms: nicknameForms(n.nickname, n.pronunciations) }));

  const groups: Array<{ spoken: string; start: number; len: number; best: number; candidates: LogicOpusNicknameCandidate[] }> = [];
  for (const w of windows) {
    const scored: LogicOpusNicknameCandidate[] = [];
    for (const n of prepared) {
      let best = 0;
      let matchedForm = "";
      for (const nf of n.forms) {
        for (const wf of w.forms) {
          // 한 글자 형태는 어절 전체가 같을 때만 인정 (예: "u"→"유")
          if ((nf.length < 2 || wf.length < 2) && nf !== wf) continue;
          const s = formSimilarity(wf, nf);
          if (s > best) { best = s; matchedForm = nf; }
        }
      }
      if (best >= MIN_SCORE) {
        scored.push({
          nickname: n.nickname,
          score: Math.min(1, best + (n.recentIntent ? 0.05 : 0)),
          matchedForm,
          recentIntent: n.recentIntent,
        });
      }
    }
    if (!scored.length) continue;
    scored.sort((a, b) => b.score - a.score);
    groups.push({ spoken: w.spoken, start: w.start, len: w.len, best: scored[0].score, candidates: scored.slice(0, 5) });
  }
  // 겹치는 구간은 점수가 높은 것만 남긴다
  groups.sort((a, b) => b.best - a.best || a.len - b.len);
  const used = new Set<number>();
  const picked: typeof groups = [];
  for (const g of groups) {
    const idx = Array.from({ length: g.len }, (_, k) => g.start + k);
    if (idx.some((i) => used.has(i))) continue;
    idx.forEach((i) => used.add(i));
    picked.push(g);
    if (picked.length >= maxGroups) break;
  }
  return picked
    .sort((a, b) => a.start - b.start)
    .map((g) => ({ eventId, spoken: g.spoken, candidates: g.candidates }));
}
