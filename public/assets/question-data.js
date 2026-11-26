export function questionData(source) {
  let data;
  try { data = JSON.parse(source); } catch { throw new Error('Questions must be valid JSON. Check commas, quotes, and brackets.'); }
  if (!Array.isArray(data) || !data.length) throw new Error('Add at least one question in a JSON array.');
  if (data.length > 200) throw new Error('A test can contain at most 200 questions.');
  return data.map((item, index) => {
    if (item?.reviewIssues?.length) throw new Error(`Question ${index + 1} needs review. Resolve its highlighted warnings before publishing.`);
    const {prompt, options, answer, section, questionNumber} = item || {};
    if ([prompt, section, ...(Array.isArray(options) ? options : [])].some(value =>
      typeof value === 'string' && /[\u0000\ufffd]/.test(value))) {
      throw new Error(`Question ${index + 1} has unreadable text. Compare with the source and repair it before publishing.`);
    }
    if (questionNumber !== undefined &&
        !(typeof questionNumber === 'string' && /^\d{1,10}$/.test(questionNumber) && Number(questionNumber) > 0) &&
        !(Number.isSafeInteger(questionNumber) && questionNumber > 0)) {
      throw new Error(`Question ${index + 1} needs a positive source question number.`);
    }
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 2000 ||
        !Array.isArray(options) || options.length < 2 || options.length > 6 ||
        options.some(value => typeof value !== 'string' || !value.trim() || value.length > 500) ||
        !Number.isInteger(answer) || answer < 0 || answer >= options.length) {
      throw new Error(`Question ${index + 1} needs a prompt, at least two options, and a valid zero-based answer.`);
    }
    return {prompt: prompt.trim(), options: options.map(value => value.trim()), answer,
      ...(questionNumber === undefined ? {} : {questionNumber: String(questionNumber)}),
      section: typeof section === 'string' && section.trim() ? section.trim() : 'General'};
  });
}
