"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { spokenLength, validateScore, repairSpeechPacing } = require("../drama-speech");
const longText = "一张旧床，两层薄被，也能让她们争上几句；真正压在心里的，却是回不去的生活。";
const shortText = "薄被惹争执，她们却放不下回不去的家。";
const shot = { id: "shot", start: 0, end: 14 };
const score = () => ({ shotId: shot.id, title: "Old bed", visual: "Keep the same room and positions.", lines: [
  { start: 0.1, end: 3.2, kind: "narration", speaker: "画外旁白", text: longText },
  { start: 4, end: 6, kind: "dialogue", speaker: "A", text: "这床有点小我们挤一挤。" },
] });

test("reported 10.32 chars/s line produces an exact actionable character budget", () => {
  assert.equal(spokenLength(longText), 32);
  assert.throws(() => validateScore(score(), shot), e => {
    assert.equal(e.code, "SPEECH_PACING"); assert.match(e.message, /10\.32 chars\/s/);
    assert.equal(e.lines[0].targetMaxCharacters, 18); assert.equal(e.lines[0].maxCharacters, 21);
    assert.equal(e.lines[0].seconds, 3.1); return true;
  });
});

test("budget repair preserves timestamps, speakers, staging and unaffected lines", async () => {
  const original = score(), before = JSON.stringify(original);
  const result = await repairSpeechPacing(original, shot, async input => {
    assert.equal(input.budgets.length, 1); assert.equal(input.budgets[0].index, 0);
    return { lines: [{ index: 0, text: shortText, start: 12, speaker: "wrong" }] };
  });
  assert.equal(JSON.stringify(original), before);
  assert.deepEqual(result.lines[0], { ...original.lines[0], text: shortText });
  assert.deepEqual(result.lines[1], original.lines[1]); assert.equal(result.visual, original.visual);
  assert.ok(validateScore(result, shot).narrationSeconds >= 3);
  assert.equal(result.repair.changes[0].originalText, longText);
});

test("invalid rewrite cannot silently omit lines, cut timing or loosen speed checks", async () => {
  for (const output of [{ lines: [] }, { lines: [{ index: 2, text: shortText }] }, { lines: [{ index: 0, text: longText }] }, { lines: [{ index: 0, text: "" }] }, { lines: [{ index: 0, text: shortText }, { index: 0, text: shortText }] }]) {
    const original = score(), before = JSON.stringify(original);
    await assert.rejects(repairSpeechPacing(original, shot, async () => output));
    assert.equal(JSON.stringify(original), before);
  }
});

test("structural errors and slow speech remain strict; valid scores need no extra LLM call", async () => {
  for (const mutate of [s => { s.lines[0].speaker = "A"; }, s => { s.lines[1].start = 1; }, s => { s.lines[1].end = 15; }, s => { s.lines[0].text = "短句"; }]) {
    const s = score(); mutate(s);
    await assert.rejects(repairSpeechPacing(s, shot, async () => { assert.fail("must not call rewrite"); }));
  }
  const s = score(); s.lines[0].text = shortText;
  assert.equal(await repairSpeechPacing(s, shot, async () => { assert.fail("already valid"); }), s);
});
