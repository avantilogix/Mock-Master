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

const delimiter = /[\s()<>[\]{}/%]/;
const multiply = ([a, b, c, d, e, f], [A, B, C, D, E, F]) =>
  [a * A + b * C, a * B + b * D, c * A + d * C, c * B + d * D, e * A + f * C + E, e * B + f * D + F];
const translate = (m, x, y) => [m[0], m[1], m[2], m[3], x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]];

function pdfString(bytes) {
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    let text = '';
    for (let index = 2; index + 1 < bytes.length; index += 2) text += String.fromCharCode(bytes[index] << 8 | bytes[index + 1]);
    return text;
  }
  return String.fromCharCode(...bytes);
}

// Minimal PDF content-stream tokenizer: calls onOperator(operator, operands) for each operator.
export function readContentStream(source, onOperator) {
  const s = Buffer.from(source).toString('latin1');
  let index = 0;
  const skip = () => {
    while (index < s.length) {
      if (/\s/.test(s[index])) index++;
      else if (s[index] === '%') while (index < s.length && !/[\r\n]/.test(s[index])) index++;
      else break;
    }
  };
  const value = () => {
    skip();
    const c = s[index];
    if (c === '<' && s[index + 1] === '<') {
      index += 2;
      const dict = {};
      for (skip(); index < s.length && !(s[index] === '>' && s[index + 1] === '>'); skip()) {
        const key = value();
        if (typeof key?.name === 'string') dict[key.name] = value();
      }
      index += 2;
      return {dict};
    }
    if (c === '<') {
      const end = s.indexOf('>', index);
      const hex = s.slice(index + 1, end < 0 ? s.length : end).replace(/\s/g, '');
      index = end < 0 ? s.length : end + 1;
      const bytes = [];
      for (let at = 0; at < hex.length; at += 2) bytes.push(parseInt(hex.slice(at, at + 2).padEnd(2, '0'), 16) || 0);
      return {bytes};
    }
    if (c === '(') {
      const bytes = [];
      let depth = 0;
      for (index++; index < s.length; index++) {
        let ch = s[index];
        if (ch === '\\') {
          ch = s[++index];
          const escape = {n: 10, r: 13, t: 9, b: 8, f: 12}[ch];
          if (escape !== undefined) bytes.push(escape);
          else if (/[0-7]/.test(ch)) {
            const octal = s.slice(index, index + 3).match(/^[0-7]{1,3}/)[0];
            bytes.push(parseInt(octal, 8) & 255);
            index += octal.length - 1;
          } else if (ch === '\r') {
            if (s[index + 1] === '\n') index++;
          } else if (ch !== '\n' && ch !== undefined) bytes.push(ch.charCodeAt(0));
          continue;
        }
        if (ch === '(') depth++;
        else if (ch === ')' && depth-- === 0) break;
        bytes.push(ch.charCodeAt(0));
      }
      index++;
      return {bytes};
    }
    if (c === '[') {
      index++;
      const array = [];
      for (skip(); index < s.length && s[index] !== ']'; skip()) array.push(value());
      index++;
      return {array};
    }
    const start = c === '/' ? ++index : index;
    while (index < s.length && !delimiter.test(s[index])) index++;
    if (index === start && c !== '/') index++;
    const token = s.slice(start, index);
    if (c === '/') return {name: token};
    return /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(token) ? {number: Number(token)} :
      /^(?:true|false|null)$/.test(token) ? {token} : {operator: token};
  };
  let operands = [];
  while (skip(), index < s.length) {
    const token = value();
    if (!token.operator) {
      operands.push(token);
      continue;
    }
    if (token.operator === 'ID') {
      const end = s.slice(index).search(/\sEI(?=\s|$)/);
      index = end < 0 ? s.length : index + end + 3;
    } else onOperator(token.operator, operands);
    operands = [];
  }
}

function toUnicodeMap(source) {
  const map = new Map();
  let bytes = 1;
  const hex = value => value.replace(/[<>\s]/g, '');
  const text = value => {
    const digits = hex(value);
    let result = '';
    for (let at = 0; at + 3 < digits.length; at += 4) result += String.fromCharCode(parseInt(digits.slice(at, at + 4), 16));
    return result;
  };
  const cmap = Buffer.from(source).toString('latin1');
  const range = cmap.match(/begincodespacerange\s*<([0-9a-f]+)>/i);
  if (range) bytes = Math.max(1, range[1].length / 2);
  const set = (code, value) => {
    // Chromium writes an unmapped <0000> before the real mapping of a shared glyph; keep the real text.
    if (!map.has(code) || /^\0*$/.test(map.get(code))) map.set(code, value);
  };
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const [, code, value] of block[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]*)>/gi)) set(parseInt(code, 16), text(value));
  }
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const [, low, high, target] of block[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*(<[0-9a-f]*>|\[[^\]]*\])/gi)) {
      const start = parseInt(low, 16), end = Math.min(parseInt(high, 16), start + 65535);
      if (target.startsWith('[')) {
        [...target.matchAll(/<([0-9a-f]*)>/gi)].forEach(([, value], offset) => {
          if (start + offset <= end) set(start + offset, text(value));
        });
      } else {
        const base = text(target);
        for (let code = start; code <= end; code++) {
          set(code, base.slice(0, -1) + String.fromCharCode(base.charCodeAt(base.length - 1) + code - start));
        }
      }
    }
  }
  return {map, bytes};
}

// Extracts text lines from Chromium/Skia PDFs. They position every glyph explicitly, leave conjunct
// glyphs unmapped, and store the real text in /ActualText spans, which pdf.js ignores. Returns
// null when a page cannot be read exactly so callers can fall back to pdf.js.
export async function chromiumPageLines(file) {
  let pdfLib, pdf;
  try {
    pdfLib = await import('pdf-lib');
    pdf = await pdfLib.PDFDocument.load(file, {ignoreEncryption: true, updateMetadata: false});
  } catch {
    return [];
  }
  const {PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream, PDFStream, decodePDFRawStream} = pdfLib;
  const look = (dict, key) => dict instanceof PDFDict ? dict.lookup(PDFName.of(key)) : undefined;
  const numbers = array => array instanceof PDFArray ? array.asArray().map(item => pdf.context.lookup(item))
    .map(item => item instanceof PDFNumber ? item.asNumber() : 0) : [];
  const decode = stream => stream instanceof PDFRawStream ? Buffer.from(decodePDFRawStream(stream).decode()) :
    stream instanceof PDFStream ? Buffer.from(stream.getContents()) : Buffer.alloc(0);
  const fontCache = new Map();
  const loadFont = font => {
    if (!(font instanceof PDFDict)) return null;
    if (fontCache.has(font)) return fontCache.get(font);
    let result = null;
    const unicode = look(font, 'ToUnicode');
    if (unicode instanceof PDFStream) {
      const {map, bytes} = toUnicodeMap(decode(unicode));
      const subtype = look(font, 'Subtype')?.asString?.();
      const widths = new Map();
      let scale = .001, fallback = 500;
      if (subtype === '/Type0') {
        const descendant = pdf.context.lookup(look(font, 'DescendantFonts')?.get?.(0));
        fallback = look(descendant, 'DW')?.asNumber?.() ?? 1000;
        const w = look(descendant, 'W');
        const entries = w instanceof PDFArray ? w.asArray().map(item => pdf.context.lookup(item)) : [];
        for (let at = 0; at < entries.length;) {
          const first = entries[at]?.asNumber?.();
          if (entries[at + 1] instanceof PDFArray) {
            numbers(entries[at + 1]).forEach((width, offset) => widths.set(first + offset, width));
            at += 2;
          } else {
            const last = entries[at + 1]?.asNumber?.(), width = entries[at + 2]?.asNumber?.();
            for (let code = first; code <= last && code - first < 65536; code++) widths.set(code, width);
            at += 3;
          }
        }
      } else {
        const first = look(font, 'FirstChar')?.asNumber?.() ?? 0;
        numbers(look(font, 'Widths')).forEach((width, offset) => widths.set(first + offset, width));
        if (subtype === '/Type3') scale = Math.abs(numbers(look(font, 'FontMatrix'))[0] || .001);
      }
      result = {map, bytes: subtype === '/Type0' ? Math.max(bytes, 2) : bytes, widths, scale, fallback};
    }
    fontCache.set(font, result);
    return result;
  };
  return pdf.getPages().map(page => {
    try {
      const lines = [];
      let line = null, spans = 0, exact = true;
      const emit = (text, x, y, size, advance, newBlock) => {
        if (!text) return;
        const sameLine = line && Math.abs(y - line.y) <= Math.max(2, size * .4);
        if (!sameLine) {
          if (line) lines.push(line);
          line = {text: '', y, end: x};
        } else if (newBlock && !/\s$/.test(line.text) && !/^\s/.test(text) && x - line.end > size * .15) line.text += ' ';
        line.text += text;
        line.end = Math.max(line.end, x + advance);
      };
      const run = (stream, resources, base, depth) => {
        if (depth > 8) {
          exact = false;
          return;
        }
        const fonts = look(resources, 'Font');
        const xObjects = look(resources, 'XObject');
        const stack = [];
        const marked = [];
        let ctm = base, tm = [1, 0, 0, 1, 0, 0], tlm = tm, font = null, size = 0, leading = 0, newBlock = true;
        const position = () => {
          const matrix = multiply(tm, ctm);
          return {x: matrix[4], y: matrix[5], scale: Math.sqrt(Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]))};
        };
        const show = bytes => {
          if (!font) {
            exact = false;
            return;
          }
          const span = marked.find(item => item.text !== null);
          for (let at = 0; at + font.bytes <= bytes.length; at += font.bytes) {
            let code = 0;
            for (let offset = 0; offset < font.bytes; offset++) code = code * 256 + bytes[at + offset];
            const {x, y, scale} = position();
            const width = (font.widths.get(code) || 0) * font.scale * size;
            if (span) {
              if (!span.shown) emit(span.text, x, y, size * scale, width * scale, newBlock);
              else if (line) line.end = Math.max(line.end, x + width * scale);
              span.shown = true;
            } else {
              const text = font.map.has(code) ? font.map.get(code) : '\ufffd';
              emit(text.replace(/\0/g, '\ufffd'), x, y, size * scale, (width || font.fallback * font.scale * size) * scale, newBlock);
            }
            newBlock = false;
            tm = translate(tm, width, 0);
          }
        };
        readContentStream(stream, (operator, operands) => {
          const n = index => operands[index]?.number ?? 0;
          switch (operator) {
            case 'q': stack.push(ctm); break;
            case 'Q': ctm = stack.pop() ?? base; break;
            case 'cm': ctm = multiply([n(0), n(1), n(2), n(3), n(4), n(5)], ctm); break;
            case 'BT': tm = tlm = [1, 0, 0, 1, 0, 0]; newBlock = true; break;
            case 'Tf': {
              const fontDict = look(fonts, operands[0]?.name ?? '');
              font = loadFont(fontDict);
              size = n(1);
              if (!font) exact = false;
              break;
            }
            case 'Tm': tm = tlm = [n(0), n(1), n(2), n(3), n(4), n(5)]; break;
            case 'TD': leading = -n(1); tm = tlm = translate(tlm, n(0), n(1)); break;
            case 'Td': tm = tlm = translate(tlm, n(0), n(1)); break;
            case 'TL': leading = n(0); break;
            case 'T*': tm = tlm = translate(tlm, 0, -leading); break;
            case 'Tj': show(operands[0]?.bytes ?? []); break;
            case "'": tm = tlm = translate(tlm, 0, -leading); show(operands[0]?.bytes ?? []); break;
            case '"': tm = tlm = translate(tlm, 0, -leading); show(operands[2]?.bytes ?? []); break;
            case 'TJ':
              for (const part of operands[0]?.array ?? []) {
                if (part.bytes) show(part.bytes);
                else if (typeof part.number === 'number') {
                  if (part.number < -250 && !marked.some(item => item.text !== null) && line && !/\s$/.test(line.text)) line.text += ' ';
                  tm = translate(tm, -part.number / 1000 * size, 0);
                }
              }
              break;
            case 'BMC': marked.push({text: null}); break;
            case 'BDC': {
              const actual = operands.at(-1)?.dict?.ActualText?.bytes;
              if (actual) spans++;
              marked.unshift({text: actual ? pdfString(actual) : null});
              break;
            }
            case 'EMC': marked.shift(); break;
            case 'Do': {
              const object = look(xObjects, operands[0]?.name ?? '');
              if (object instanceof PDFStream && look(object.dict, 'Subtype')?.asString?.() === '/Form') {
                const matrix = numbers(look(object.dict, 'Matrix'));
                run(decode(object), look(object.dict, 'Resources') ?? resources,
                  multiply(matrix.length === 6 ? matrix : [1, 0, 0, 1, 0, 0], ctm), depth + 1);
              }
              break;
            }
          }
        });
      };
      let contents = page.node.Contents();
      contents = contents instanceof PDFArray ? contents.asArray().map(ref => pdf.context.lookup(ref)) : [contents];
      run(Buffer.concat(contents.map(decode).flatMap(part => [part, Buffer.from('\n')])), page.node.Resources(), [1, 0, 0, 1, 0, 0], 0);
      if (line) lines.push(line);
      return spans && exact ? lines.map(({text, y}) => ({text, y})) : null;
    } catch {
      return null;
    }
  });
}

export async function pdfQuestionText(file, getDocument) {
  if (!Buffer.isBuffer(file) || !file.subarray(0, 5).equals(Buffer.from('%PDF-'))) fail('Expected a PDF.');
  const loading = getDocument({data: new Uint8Array(file), useSystemFonts: true, isEvalSupported: false});
  try {
    const document = await loading.promise;
    if (document.numPages < 1 || document.numPages > 500) fail('Expected an unencrypted PDF with 1–500 pages.');
    const native = await chromiumPageLines(file);
    const pages = [];
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const height = page.getViewport({scale: 1}).height;
      const lines = [];
      const add = (value, baseline) => {
        const text = clean(value);
        const margin = baseline < 60 || baseline > height - 75;
        const header = /page\s*\d+\s*(?:of|\/)\s*\d+/i.test(text) ||
          /^telegram\s*(?:channel|:)/i.test(text) || /^GSSSB.*Telegram/i.test(text);
        if (text && !(margin && header)) lines.push(text);
      };
      if (native.length === document.numPages && native[number - 1]) {
        native[number - 1].forEach(item => add(item.text, item.y));
      } else {
        const content = await page.getTextContent();
        let line = '', baseline, previous;
        const flush = () => {
          add(line, baseline);
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
      }
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
