const digits = value => value.replace(/[૦-૯०-९]/g, digit =>
  String(digit.charCodeAt(0) - (digit >= '૦' ? 0x0ae6 : 0x0966)));
const clean = value => value.replace(/\u0000/g, '\ufffd')
  .replace(/([્्])\s+(?=[\p{Script=Gujarati}\p{Script=Devanagari}])/gu, '$1')
  .replace(/([\p{Script=Gujarati}\p{Script=Devanagari}\ufffd])\s+(?=[\u0abc-\u0acd\u093c-\u094d])/gu, '$1')
  .replace(/[ \t]+/g, ' ').trim();
const questionPattern = /^(?:(પ્રશ્ન|question|q)\s*[.:]?\s*)?(\d{1,10})\s*[.):：-]\s*(.*)$/i;
const optionPattern = /(?:^|\s)(?:\(\s*([A-Fઅબકખગઘડ])\s*\)|([A-F])\s*[.)])\s*/gi;
const answerPattern = /^(?:(?:correct\s+)?ans(?:wer)?|(?:સાચો\s+)?જવાબ|ઉત્તર)\s*[:：=-]\s*(.*)$/i;
const keyPairPattern = /(\d{1,10})\s*[.):=-]?\s*[\[(]?\s*([A-F])\s*[\])]?/gi;

function fail(message) {
  throw Object.assign(new Error(message), {status: 422});
}

export async function pdfQuestionText(file, getDocument) {
  if (!Buffer.isBuffer(file) || !file.subarray(0, 5).equals(Buffer.from('%PDF-'))) fail('Expected a PDF.');
  const loading = getDocument({data: new Uint8Array(file), useSystemFonts: true, isEvalSupported: false});
  try {
    const document = await loading.promise;
    if (document.numPages < 1 || document.numPages > 500) fail('Expected an unencrypted PDF with 1–500 pages.');
    const pages = [];
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      const height = page.getViewport({scale: 1}).height;
      const lines = [];
      let line = '', baseline, previous;
      const flush = () => {
        const text = clean(line);
        const margin = baseline < 60 || baseline > height - 75;
        const header = /page\s*\d+\s*(?:of|\/)\s*\d+/i.test(text) ||
          /^telegram\s*(?:channel|:)/i.test(text) || /^GSSSB.*Telegram/i.test(text);
        if (text && !(margin && header)) lines.push(text);
        line = '';
        previous = baseline = undefined;
      };
      for (const item of content.items) {
        if (typeof item.str !== 'string') continue;
        const y = item.transform[5];
        if (Number.isFinite(baseline) && Math.abs(y - baseline) > 2) flush();
        if (previous && line && !/\s$/.test(line) && !/^\s/.test(item.str)) {
          const gap = item.transform[4] - previous.transform[4] - previous.width;
          if (previous.width > 0 && gap > Math.max(.8, Math.abs(item.transform[0]) * .18)) line += ' ';
        }
        line += item.str;
        baseline = y;
        previous = item;
        if (item.hasEOL) flush();
      }
      flush();
      pages.push(lines.join('\n'));
      page.cleanup();
    }
    return pages.join('\n');
  } finally {
    await loading.destroy();
  }
}

export function parseQuestions(text) {
  const lines = text.split(/[\n\f]/).map(clean).filter(Boolean);
  for (let index = 0; index < lines.length - 1; index++) {
    if (/^(?:પ્રશ્ન|question|q)\s*[.:]?$/i.test(lines[index])) {
      lines.splice(index, 2, `${lines[index]} ${lines[index + 1]}`);
    }
  }
  const explicit = lines.some(line => digits(line).match(questionPattern)?.[1]);
  const questions = [];
  const keys = new Map();
  let current, inKey = false, section = 'General';
  const finish = () => {
    if (current) questions.push(current);
    current = null;
  };
  for (const line of lines) {
    const normalized = digits(line);
    const pairs = [...normalized.matchAll(keyPairPattern)];
    const keyRow = pairs.length > 0 && !normalized.replace(keyPairPattern, '').replace(/[|,;\s]+/g, '');
    if (keyRow && (inKey || pairs.length > 1)) {
      finish();
      inKey = true;
      for (const [, number, label] of pairs) {
        const existing = keys.get(String(Number(number)));
        const answer = label.toUpperCase();
        keys.set(String(Number(number)), existing === undefined || existing === answer ? answer : null);
      }
      continue;
    }
    if (/^(?:(?:verified\s+)?answer\s*key|ઉત્તરવ[હ�]|જવાબ\s*(?:સૂચિ|તાલિકા))/i.test(line) ||
        (current?.options.length && /answer\s*key/i.test(line) && !/આપ|given|provided/i.test(line))) {
      finish();
      inKey = true;
      continue;
    }
    if (inKey) continue;
    if (/^(?:વિભાગ|�વભાગ|section)\s*[-–—:]?\s*[૦-૯0-9]+/i.test(line)) {
      finish();
      section = line.slice(0, 100);
      continue;
    }
    const prompt = normalized.match(questionPattern);
    const answer = line.match(answerPattern);
    if (prompt && (prompt[1] || (!explicit && (!current || current.options.length >= 2)))) {
      finish();
      const offset = prompt[0].length - prompt[3].length;
      current = {questionNumber: String(Number(prompt[2])), prompt: line.slice(offset), options: [], labels: [], answers: [], section};
      continue;
    }
    if (!current) continue;
    if (answer) {
      current.answers.push(answer[1].trim());
      continue;
    }
    const options = [...line.matchAll(optionPattern)];
    if (options.length && !line.slice(0, options[0].index).trim() && !current.answers.length) {
      options.forEach((match, index) => {
        current.labels.push((match[1] || match[2]).toUpperCase());
        current.options.push(line.slice(match.index + match[0].length, options[index + 1]?.index ?? line.length).trim());
      });
    } else if (!current.answers.length) {
      if (current.options.length) current.options[current.options.length - 1] += ` ${line}`;
      else current.prompt += `${current.prompt ? '\n' : ''}${line}`;
    }
  }
  finish();
  if (!questions.length) fail('No questions were found. Use numbered questions with labeled choices. Scanned PDFs need OCR before import.');
  if (questions.length > 200) fail(`Found ${questions.length} questions. Split this file into tests of at most 200 questions.`);
  const duplicates = new Set(questions.filter((question, index) =>
    questions.findIndex(other => other.questionNumber === question.questionNumber) !== index).map(question => question.questionNumber));
  return questions.map(question => {
    const issues = [];
    const {questionNumber, labels} = question;
    const prompt = question.prompt.trim();
    const options = question.options.map(option => option.trim());
    const candidates = [...question.answers];
    if (keys.has(questionNumber)) candidates.push(keys.get(questionNumber));
    const resolve = value => {
      if (typeof value !== 'string') return -1;
      const label = value.match(/^\(?\s*([A-Fઅબકખગઘડ])\s*\)?(?:[.):]|\s|$)/i)?.[1]?.toUpperCase();
      if (label) return labels.indexOf(label);
      const number = digits(value).match(/^\(?([1-6])\)?[.)]?$/)?.[1];
      if (number) return Number(number) <= options.length ? Number(number) - 1 : -1;
      const matches = options.map((option, index) => option === value ? index : -1).filter(index => index >= 0);
      return matches.length === 1 ? matches[0] : -1;
    };
    const answers = candidates.map(resolve);
    const answer = answers.length && answers.every(value => value >= 0 && value === answers[0]) ? answers[0] : null;
    if (answer === null) issues.push(candidates.length ? 'The answer is invalid or conflicting. Select the correct answer.' :
      'No correct answer was found. Select the correct answer.');
    if (!prompt || prompt.length > 2000) issues.push('Review the question text (required, up to 2000 characters).');
    if (options.length < 2 || options.length > 6 || options.some(option => !option || option.length > 500)) {
      issues.push('Review the choices: use 2–6 non-empty options, up to 500 characters each.');
    }
    const alphabet = labels[0] === 'અ' ? [...'અબકડ'] : labels[0] === 'ક' ? [...'કખગઘ'] : [...'ABCDEF'];
    if (labels.some((label, index) => label !== alphabet[index])) issues.push('Choice labels are missing, repeated, or out of order. Check their text and answer.');
    if (duplicates.has(questionNumber)) issues.push('This source question number is repeated. Check that the question was split correctly.');
    if (/\ufffd/.test([prompt, ...options, question.section].join(''))) issues.push('The PDF contains unreadable characters (�). Compare with the source and repair the text.');
    return {questionNumber, prompt, options, answer, section: question.section, ...(issues.length ? {reviewIssues: issues} : {})};
  });
}
