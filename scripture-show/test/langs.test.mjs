import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatRef, parseFollowUp, parseReferences } from '../public/js/books.js';

const ref = (text, lang, names) => parseReferences(text, names, lang).map((r) => formatRef(r)).join(' ; ');

test('spoken references in many languages', () => {
  const cases = [
    ['es-ES', 'Abran sus biblias en Juan capítulo tres versículo dieciséis', 'John 3:16'],
    ['es-MX', 'leamos primera de Corintios trece del cuatro al siete', '1 Corinthians 13:4–7'],
    ['es-ES', 'el Salmo ciento diecinueve versículo ciento cinco', 'Psalms 119:105'],
    ['es-ES', 'Romanos 8.28 dice', 'Romans 8:28'],
    ['es-ES', 'el evangelio según San Mateo capítulo cinco versículos tres a doce', 'Matthew 5:3–12'],
    ['pt-BR', 'Vamos ler em João capítulo três versículo dezesseis', 'John 3:16'],
    ['pt-BR', 'primeira carta aos Coríntios capítulo treze versículos quatro a sete', '1 Corinthians 13:4–7'],
    ['fr-FR', 'Ouvrons nos bibles dans Jean chapitre trois verset seize', 'John 3:16'],
    ['fr-FR', 'Psaume quatre-vingt-onze verset un', 'Psalms 91:1'],
    ['fr-FR', 'la première épître aux Corinthiens chapitre treize versets quatre à sept', '1 Corinthians 13:4–7'],
    ['de-DE', 'Lesen wir Johannes Kapitel drei Vers sechzehn', 'John 3:16'],
    ['de-DE', 'im ersten Brief an die Korinther Kapitel dreizehn Vers vier bis sieben', '1 Corinthians 13:4–7'],
    ['de-DE', '1. Mose 1,1', 'Genesis 1:1'],
    ['it-IT', 'Giovanni capitolo tre versetto sedici', 'John 3:16'],
    ['it-IT', 'Salmo centodiciannove versetto centocinque', 'Psalms 119:105'],
  ];
  for (const [lang, text, want] of cases) assert.equal(ref(text, lang), want, `${lang}: ${text}`);
});

test('scripts and book names from a translation in that language', () => {
  assert.equal(ref('요한복음 3장 16절 말씀입니다', 'ko-KR', { 요한복음: 43 }), 'John 3:16');
  assert.equal(ref('시편 23장 1절부터 4절까지', 'ko-KR', { 시편: 19 }), 'Psalms 23:1–4');
  assert.equal(ref('请翻到约翰福音三章十六节', 'zh-CN', { 约翰福音: 43 }), 'John 3:16');
  assert.equal(ref('يوحنا الاصحاح ٣ العدد ١٦', 'ar-SA', { يوحنا: 43 }), 'John 3:16');
  assert.equal(ref('Иоанна глава 3 стих 16', 'ru-RU', { Иоанна: 43 }), 'John 3:16');
  assert.equal(ref('Johanu ori 3 ese 16', 'yo-NG', { Johanu: 43 }), 'John 3:16');
  assert.equal(ref('Yohana sura 3 mstari 16', 'sw-KE', { Yohana: 43 }), 'John 3:16');
});

test('ordinary speech is not mistaken for scripture', () => {
  assert.equal(ref('la gente es muy buena y la iglesia crece', 'es-ES'), '');
  assert.equal(ref('il est venu à la maison avec deux amis', 'fr-FR'), '');
});

test('follow-ups in the preacher’s language', () => {
  assert.deepEqual(parseFollowUp('y miren el versículo diecisiete', 'es-ES'), { kind: 'verse', verseStart: 17, verseEnd: 17 });
  assert.deepEqual(parseFollowUp('el siguiente versículo', 'es-ES'), { kind: 'next' });
  assert.deepEqual(parseFollowUp('versículos dezoito a vinte', 'pt-BR'), { kind: 'verse', verseStart: 18, verseEnd: 20 });
  assert.deepEqual(parseFollowUp('chapitre quatre verset deux', 'fr-FR'), { kind: 'chapter', chapter: 4, verseStart: 2, verseEnd: 2 });
  assert.deepEqual(parseFollowUp('der nächste Vers', 'de-DE'), { kind: 'next' });
  assert.deepEqual(parseFollowUp('17절을 보세요', 'ko-KR'), { kind: 'verse', verseStart: 17, verseEnd: 17 });
  assert.deepEqual(parseFollowUp('第十七节', 'zh-CN'), { kind: 'verse', verseStart: 17, verseEnd: 17 });
  assert.deepEqual(parseFollowUp('mstari 17', 'sw-KE'), { kind: 'verse', verseStart: 17, verseEnd: 17 });
});
